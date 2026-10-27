# Verifica differenze master / slave

Mi servono alcuni dati da **entrambe** le macchine (master e slave) per capire perché le due proiezioni non coincidono. Ci vogliono circa 10 minuti, più una seconda misura dopo mezz'ora. Non si modifica niente del sistema.

**Prima di iniziare:** il sistema deve girare normalmente su tutte e due le macchine, con la **stessa scena** caricata.

Tutti i passaggi vanno fatti **su ciascuna macchina**, nella finestra della visualizzazione (quella a schermo intero sul monitor esterno), **non** nella finestra dei controlli.

---

## 1. Zoom di Chrome

Premi **Cmd + 0** per riportare lo zoom di Chrome al 100%.
Se l'immagine cambia, scrivimelo: è già un indizio.

## 2. Aprire la console

1. Premi **Cmd + Option + J**.
2. Se Chrome blocca l'incolla, scrivi a mano `allow pasting` e premi Invio.

## 3. Dati del display

Incolla questa riga nella console e premi Invio:

```js
(()=>{const gl=drawingContext,e=gl.getExtension('WEBGL_debug_renderer_info');const r={host:location.host,dpr:devicePixelRatio,pixelDensity:pixelDensity(),canvasCSS:[width,height],canvasBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],window:[innerWidth,innerHeight],screen:[screen.width,screen.height],fps:Math.round(frameRate()),maxPointSize:gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1],gpu:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'n/a',fullscreen:!!document.fullscreenElement};copy(JSON.stringify(r));console.table(r);})()
```

Il risultato viene copiato automaticamente negli appunti. Incollamelo in chat e scrivi se è il **master** o lo **slave**.

## 4. FPS medio

Incolla quest'altra riga, aspetta 5 secondi e mandami il numero che compare (`fps medio`):

```js
(()=>{const s=[],id=setInterval(()=>s.push(frameRate()),250);setTimeout(()=>{clearInterval(id);console.log('fps medio',(s.reduce((a,b)=>a+b)/s.length).toFixed(1))},5000)})()
```

## 5. Test del ricaricamento (importante)

1. Con la finestra **già sul monitor esterno**, premi **Cmd + R** per ricaricare la pagina.
2. Rimettila a schermo intero con il tasto **F**.
3. Ripeti il **punto 3** e mandami il nuovo risultato.
4. Scrivimi se i boid **cambiano dimensione** dopo il ricaricamento.

## 6. Impostazioni di sistema

In **Impostazioni di Sistema → Schermi**, selezionando il monitor esterno, scrivimi:

- la **risoluzione** (ed eventualmente se è "scalata", "Testo più grande", "Più spazio" ecc.);
- la **frequenza di aggiornamento** (60 Hz, 120 Hz…);
- se lo schermo è in modalità **duplicata** o **estesa**;
- quale **profilo colore** è selezionato;
- se **Night Shift** è attivo.

Mandami anche il **modello del Mac** (menu Mela → Informazioni su questo Mac).

## 7. Foto

Una **foto o uno screenshot** di ciascuna proiezione, con la stessa scena attiva, per confrontare le dimensioni dei boid.

## 8. Seconda misura dopo 20–30 minuti

Lascia girare il sistema per 20–30 minuti, poi ripeti il **punto 4** (FPS medio) su entrambe le macchine, soprattutto sul **MacBook Air**.

---

## Riepilogo da compilare (facoltativo)

| | Master | Slave |
|---|---|---|
| Modello Mac | | |
| Zoom cambiava l'immagine? | | |
| `dpr` / `pixelDensity` (prima del ricaricamento) | | |
| `dpr` / `pixelDensity` (dopo il ricaricamento) | | |
| `canvasCSS` | | |
| FPS medio all'avvio | | |
| FPS medio dopo 20–30 min | | |
| Risoluzione / scalatura macOS | | |
| Frequenza (Hz) | | |
| Duplicato / esteso | | |
| Profilo colore | | |
| Night Shift | | |
| I boid cambiano dopo il ricaricamento? | | |

Grazie mille!
