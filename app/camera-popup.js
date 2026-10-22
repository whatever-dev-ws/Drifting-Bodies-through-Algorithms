// camera-popup.js — camera popup window logic (self-contained)

let camPopupWin = null;

function getCameraStream(video) {
  const el = video && video.elt;
  if (!el) return null;
  if (el.srcObject) return el.srcObject;
  if (el.captureStream) return el.captureStream(30);
  return null;
}

export function openCameraPopup(video, canvasWidth, canvasHeight) {
  const w = Math.min(640, canvasWidth);
  const h = Math.min(480, canvasHeight);
  const features = `popup=yes,width=${w + 16},height=${h + 90},left=140,top=120`;

  if (!camPopupWin || camPopupWin.closed) {
    camPopupWin = window.open('', 'BodyPoseCameraPopup', features);
  }
  if (!camPopupWin) return; // popup blocked

  camPopupWin.document.title = 'Camera';
  camPopupWin.document.body.style.margin = '0';
  camPopupWin.document.body.style.background = '#000';
  camPopupWin.document.body.innerHTML = `
    <video id="cam" autoplay playsinline muted
      style="width:100%;height:100%;object-fit:contain;background:#000;"></video>
    <div style="position:fixed;bottom:6px;right:10px;padding:4px 8px;font:12px system-ui;color:#fff;background:#0008;border-radius:8px;">
      Webcam stream
    </div>
  `;

  const vid = camPopupWin.document.getElementById('cam');

  try { if (video && video.elt && video.elt.play) video.elt.play(); } catch (e) {}

  const stream = getCameraStream(video);
  if (stream) {
    try { vid.srcObject = stream; vid.play(); } catch (e) { console.warn('Attach camera stream failed:', e); }
  } else {
    console.warn('No camera stream available yet.');
  }

  camPopupWin.resizeTo(w + 16, h + 90);
  camPopupWin.addEventListener('beforeunload', () => { camPopupWin = null; });
}

export function refreshCameraPopup(video) {
  if (!camPopupWin || camPopupWin.closed) return;
  const vid = camPopupWin.document.getElementById('cam');
  if (!vid) return;
  const stream = getCameraStream(video);
  if (stream) {
    try { vid.srcObject = stream; vid.play(); } catch (e) { console.warn('Refresh camera popup failed:', e); }
  }
}

export function resizeCameraPopup(canvasWidth, canvasHeight) {
  if (camPopupWin && !camPopupWin.closed) {
    const w = Math.min(640, canvasWidth);
    const h = Math.min(480, canvasHeight);
    camPopupWin.resizeTo(w + 16, h + 90);
  }
}
