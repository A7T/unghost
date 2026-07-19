// unghost — page controller (intake, rendering, wiring).
import {
  W, H, unionErase, outlineMask, ocrFrame, voteResults,
  buildTemplates, ensureFont,
} from './decoder.js';

const $ = id => document.getElementById(id);
const drop = $('drop'), file = $('file'), vid = $('vid');
const srcC = $('src'), outC = $('out');
const sctx = srcC.getContext('2d'), octx = outC.getContext('2d');

let frames = [];
let isVideo = false;
let lastDark = null, lastInterior = null;
let lastBoxes = null;

function setStatus(t) { $('status').textContent = t; }

// ---------------- intake ----------------
drop.onclick = e => { if (e.target.tagName !== 'BUTTON') file.click(); };
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); load(e.dataTransfer.files[0]); };
file.onchange = () => load(file.files[0]);
$('demoBtn').onclick = async () => {
  try {
    setStatus('Loading sample clip…');
    const r = await fetch('media/ghost.mp4');
    if (!r.ok) throw new Error('404');
    const blob = await r.blob();
    await load(new File([blob], 'ghost.mp4', { type: 'video/mp4' }));
  } catch {
    setStatus('Sample clip unavailable — serve this page over HTTP and retry.');
  }
};

async function load(f) {
  if (!f) return;
  frames = []; lastBoxes = null;
  $('result').textContent = ''; $('votes').classList.add('hidden'); $('votes').innerHTML = '';
  if (f.type.startsWith('image/')) {
    isVideo = false;
    const img = await createImageBitmap(f);
    drawToSrc(img);
    frames = [getSrc()];
    afterLoad();
  } else if (f.type.startsWith('video/')) {
    isVideo = true;
    setStatus('Extracting frames…');
    await extractVideo(f);
    afterLoad();
  } else {
    setStatus('Unsupported file type.');
  }
}

function drawToSrc(img) {
  srcC.width = W; srcC.height = H;
  sctx.drawImage(img, 0, 0, W, H);
}
function getSrc() { return sctx.getImageData(0, 0, W, H); }

async function extractVideo(f) {
  const url = URL.createObjectURL(f);
  vid.src = url;
  await new Promise(r => vid.onloadedmetadata = r);
  const dur = vid.duration;
  const N = Math.min(16, Math.max(6, Math.floor(dur * 3)));
  for (let i = 0; i < N; i++) {
    vid.currentTime = (i + 0.5) / N * dur;
    await new Promise(r => vid.onseeked = r);
    drawToSrc(vid);
    frames.push(getSrc());
    setStatus(`Extracting frame ${i + 1}/${N}`);
  }
  URL.revokeObjectURL(url);
}

function afterLoad() {
  $('ui').classList.remove('hidden');
  $('frameIdx').max = Math.max(0, frames.length - 1);
  $('frameIdx').value = 0;
  run();
}

// ---------------- rendering ----------------
function renderOutline(dark, interior, boxes) {
  const id = octx.createImageData(W, H);
  const boxSet = new Uint8Array(W * H);
  if (boxes) {
    for (const { box } of boxes) {
      const [x0, y0, x1, y1] = box;
      for (let x = x0; x < x1; x++) {
        if (y0 > 0) boxSet[(y0 - 1) * W + x] = 1;
        if (y1 < H) boxSet[y1 * W + x] = 1;
      }
      for (let y = y0; y < y1; y++) {
        if (x0 > 0) boxSet[y * W + x0 - 1] = 1;
        if (x1 < W) boxSet[y * W + x1] = 1;
      }
    }
  }
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    if (boxSet[p]) {
      id.data[i] = 79; id.data[i + 1] = 140; id.data[i + 2] = 255;
    } else if (dark[p] && !interior[p]) {
      id.data[i] = 236; id.data[i + 1] = 240; id.data[i + 2] = 248;
    } else if (dark[p]) {
      id.data[i] = 22; id.data[i + 1] = 26; id.data[i + 2] = 34;
    }
    id.data[i + 3] = 255;
  }
  octx.putImageData(id, 0, 0);
}

function renderSrcOverlay() {
  if (!$('overlay').checked || !lastDark) return;
  octx.globalAlpha = 0.5; octx.drawImage(srcC, 0, 0); octx.globalAlpha = 1;
  octx.fillStyle = 'rgba(56,224,255,0.95)';
  for (let p = 0; p < W * H; p++)
    if (lastDark[p] && !lastInterior[p]) octx.fillRect(p % W, (p / W) | 0, 2, 2);
  if (lastBoxes) {
    octx.strokeStyle = 'rgba(124,92,255,0.95)'; octx.lineWidth = 2;
    for (const { box } of lastBoxes) {
      const [x0, y0, x1, y1] = box;
      octx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
}

// ---------------- run / OCR ----------------
function run() {
  const idx = +$('frameIdx').value || 0;
  if (!frames.length) return;
  const img = frames[idx];
  sctx.putImageData(img, 0, 0);
  $('frameLabel').textContent = isVideo ? `frame ${idx} / ${frames.length - 1}` : 'still image';
  const thr = +$('thr').value, period = +$('period').value;
  const t0 = performance.now();
  const { dark, interior } = unionErase(img, thr, period);
  lastDark = dark; lastInterior = interior; lastBoxes = null;
  let n = 0;
  for (let p = 0; p < W * H; p++) if (dark[p] && !interior[p]) n++;
  if ($('overlay').checked) renderSrcOverlay();
  else renderOutline(dark, interior, null);
  $('outInfo').textContent = `${n.toLocaleString()} px · ${(performance.now() - t0).toFixed(0)} ms`;
  setStatus('Outline extracted.');
}

async function doOcr() {
  if (!frames.length) return;
  const btn = $('doOcr');
  btn.disabled = true;
  setStatus('Rendering templates…');
  await ensureFont();
  buildTemplates();
  const thr = +$('thr').value, period = +$('period').value;
  const t0 = performance.now();

  const cur = +$('frameIdx').value || 0;
  const idxs = isVideo ? frames.map((_, i) => i) : [cur];
  const perFrame = [];
  for (let k = 0; k < idxs.length; k++) {
    const { dark, interior } = unionErase(frames[idxs[k]], thr, period);
    const r = ocrFrame(dark, interior);
    perFrame.push(r);
    if (isVideo) {
      setStatus(`Reading frame ${k + 1}/${idxs.length}`);
      await new Promise(r => setTimeout(r));
    }
    if (idxs[k] === cur) { lastBoxes = r.boxes; lastDark = dark; lastInterior = interior; }
  }
  const curRes = perFrame[idxs.indexOf(cur)];
  if (curRes) lastBoxes = curRes.boxes;

  let finalLines;
  if (isVideo && perFrame.length > 1) {
    finalLines = voteResults(perFrame);
    const vw = $('votes');
    vw.innerHTML = perFrame.map((r, i) => {
      const s = r.lines.join(' / ') || '(empty)';
      const agree = r.lines.join(' ') === finalLines.join(' ');
      return `<span class="vote${agree ? '' : ' miss'}">f${idxs[i]}: <b>${s}</b></span>`;
    }).join('');
    vw.classList.remove('hidden');
  } else {
    finalLines = perFrame[0].lines;
    $('votes').classList.add('hidden');
  }

  if ($('overlay').checked) renderSrcOverlay();
  else renderOutline(lastDark, lastInterior, lastBoxes);

  $('result').textContent = finalLines.join('\n');
  $('timeInfo').textContent = `${(performance.now() - t0).toFixed(0)} ms · ${perFrame.length} frame${perFrame.length > 1 ? 's' : ''}`;
  setStatus('Done (outline-template NCC · ' + (isVideo ? 'multi-frame vote' : 'single frame') + ').');
  btn.disabled = false;
}

$('doOcr').onclick = doOcr;
$('frameIdx').oninput = run;
$('thr').oninput = run;
$('period').onchange = run;
$('overlay').onchange = run;
