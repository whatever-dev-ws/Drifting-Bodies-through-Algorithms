// server.js — static file server + WebSocket relay for phone controller
// Usage: node server/server.js [port] [--master | --slave <master-ip>]
// Serves ../app over HTTP and relays WebSocket messages
// between all connected clients (phone → main page → BroadcastChannel)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

// --- Parse arguments ---
const args = process.argv.slice(2);
let PORT = 3000;
let ROLE = 'standalone'; // 'standalone', 'master', or 'slave'
let MASTER_HOST = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--master') {
    ROLE = 'master';
  } else if (args[i] === '--slave' && args[i + 1]) {
    ROLE = 'slave';
    MASTER_HOST = args[++i]; // ip or ip:port
  } else if (/^\d+$/.test(args[i])) {
    PORT = parseInt(args[i]);
  }
}

// Web root is the sibling app/ folder, so browser URLs (/phone.html,
// /vendor/...) are unchanged and server code is never served.
const ROOT = path.join(__dirname, '..', 'app');

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.bin':  'application/octet-stream',
  '.wasm': 'application/wasm',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

// --- Get local LAN IP ---
function getLocalIP() {
  const nets = require('os').networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const cfg of iface) {
      if (cfg.family === 'IPv4' && !cfg.internal) return cfg.address;
    }
  }
  return 'localhost';
}

// --- Machine name, for Re-detect Display reports (Setup → Debug) ---
// macOS ComputerName ("MacBook Air") — os.hostname() is often a generic
// "Mac.lan" that every machine shares.
let MACHINE_NAME = require('os').hostname().split('.')[0];
try {
  MACHINE_NAME = require('child_process')
    .execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8' }).trim() || MACHINE_NAME;
} catch (_) {}

// --- Connection tracking ---
const clients = new Set();          // local browser/phone WebSocket clients
const slaveConnections = new Set(); // slave server WS connections (master only)
let masterWs = null;                // WS connection to master (slave only)

// --- Heartbeat: detect and clean up broken connections ---
const PING_INTERVAL = 20000; // 20s

// --- HTTP static file server ---
const server = http.createServer((req, res) => {
  // API: phone URL
  if (req.url === '/api/phone-url') {
    const ip = getLocalIP();
    const url = `http://${ip}:${PORT}/phone.html`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url, ip, port: PORT }));
    return;
  }

  // API: role info
  if (req.url === '/api/role') {
    let body;
    if (ROLE === 'master') {
      body = { role: 'master', slaveCount: slaveConnections.size };
    } else if (ROLE === 'slave') {
      body = { role: 'slave', connected: !!masterWs && masterWs.readyState === WebSocket.OPEN };
    } else {
      body = { role: 'standalone' };
    }
    // Identifies this machine in Re-detect Display reports (Setup → Debug)
    body.host = MACHINE_NAME;
    body.ip = getLocalIP();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
    return;
  }

  // Strip ?query / #hash — otherwise /phone.html?x looks for a file named
  // "phone.html?x" and 404s
  const urlPath = req.url.split(/[?#]/)[0];
  let filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  // Prevent directory traversal
  if (!filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

// --- WebSocket relay ---
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const isSlaveLink = req.url === '/slave-link';

  // ── Heartbeat tracking ──
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // ── Slave server connecting to master ──
  if (isSlaveLink && ROLE === 'master') {
    slaveConnections.add(ws);
    console.log(`[master] slave connected (${slaveConnections.size} slaves)`);

    ws.on('message', (data) => {
      const msg = data.toString();
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'sync-to-master') {
          // Slave wants full state. Ask EVERY local client: only a main page
          // answers `sync` (with a snapshot, which the relay below forwards to
          // the slaves); phones and the scene manager ignore it. Asking just
          // the first client failed whenever that was a phone or the scene
          // manager — e.g. after the main page reloaded and re-joined last.
          const ask = JSON.stringify({ type: 'sync' });
          for (const client of clients) {
            if (client.readyState === WebSocket.OPEN) client.send(ask);
          }
        } else if (parsed.type === 'display-info') {
          // A slave's Re-detect Display report → the master's controls window
          for (const client of clients) {
            if (client.readyState === WebSocket.OPEN) client.send(msg);
          }
        }
      } catch (_) {}
    });

    ws.on('error', (err) => {
      console.log(`[master] slave connection error: ${err.message}`);
    });

    ws.on('close', () => {
      slaveConnections.delete(ws);
      console.log(`[master] slave disconnected (${slaveConnections.size} slaves)`);
    });
    return;
  }

  // ── Normal browser/phone client ──
  clients.add(ws);
  console.log(`[ws] client connected (${clients.size} total)`);

  ws.on('message', (data) => {
    const msg = data.toString();

    // Relay to all OTHER local clients
    for (const client of clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }

    // MASTER: relay relevant messages to all slave servers
    if (ROLE === 'master') {
      try {
        const parsed = JSON.parse(msg);
        if (['set', 'state', 'snapshot', 'sync-slaves', 'display-refresh'].includes(parsed.type)) {
          for (const slave of slaveConnections) {
            if (slave.readyState === WebSocket.OPEN) {
              // For sync-slaves, convert to a snapshot so slaves apply the full state
              slave.send(msg);
            }
          }
        }
      } catch (_) {}
    }

    // SLAVE: forward sync-to-master and display reports upstream
    if (ROLE === 'slave' && masterWs && masterWs.readyState === WebSocket.OPEN) {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'sync-to-master' || parsed.type === 'display-info') {
          masterWs.send(msg);
        }
      } catch (_) {}
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[ws] client disconnected (${clients.size} total)`);
  });
});

// --- Heartbeat interval: ping all connections, terminate unresponsive ones ---
const heartbeat = setInterval(() => {
  for (const ws of clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  for (const ws of slaveConnections) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, PING_INTERVAL);

wss.on('close', () => clearInterval(heartbeat));

// --- Start server ---
server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log(`\n  Role:     ${ROLE.toUpperCase()}`);
  console.log(`  Serving:  http://localhost:${PORT}/`);
  if (ROLE !== 'slave') {
    console.log(`  Phone:    http://${localIP}:${PORT}/phone.html`);
  }
  if (ROLE === 'master') {
    console.log(`  Slave link: ws://${localIP}:${PORT}/slave-link`);
  }
  console.log(`  WebSocket relay active on same port\n`);
});

// --- Slave mode: connect to master ---
if (ROLE === 'slave' && MASTER_HOST) {
  const masterPort = MASTER_HOST.includes(':') ? '' : `:${PORT}`;
  const masterUrl = `ws://${MASTER_HOST}${masterPort}/slave-link`;

  function connectToMaster() {
    console.log(`[slave] connecting to master at ${masterUrl}...`);
    masterWs = new WebSocket(masterUrl);

    masterWs.on('open', () => {
      console.log('[slave] connected to master');
    });

    masterWs.on('ping', () => {
      // ws library auto-sends pong, but log for debugging
    });

    masterWs.on('message', (data) => {
      // Tag what comes from the master, so this machine's pages can tell it
      // from their own local traffic (e.g. a phone on this slave). channel.js
      // uses the tag to keep this machine's rig settings — its own camera,
      // detection and webcam display — out of master updates.
      let msg = data.toString();
      try {
        const parsed = JSON.parse(msg);
        parsed.fromMaster = true;
        msg = JSON.stringify(parsed);
      } catch (_) {}
      // Relay master messages to all local browser clients
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg);
        }
      }
    });

    masterWs.on('close', (code, reason) => {
      console.log(`[slave] disconnected from master (code=${code}, reason=${reason || 'none'}), reconnecting in 3s...`);
      masterWs = null;
      setTimeout(connectToMaster, 3000);
    });

    masterWs.on('error', (err) => {
      console.log(`[slave] connection error: ${err.message}`);
      // error event is always followed by close event, no need to call close()
    });
  }

  connectToMaster();
}
