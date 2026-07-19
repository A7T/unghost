// unghost — Ghost Font decoder core.
//
// Ghost Font (mixfont.com/ghost-font) hides text by scrolling the noise dots
// inside the glyph mask UP while the background dots scroll DOWN. The two dot
// layers share a horizontal lattice phase and differ only vertically, so where
// they overlap they fuse into solid 3x4 / 3x5 / 3x6 blocks that carry no edge
// information. Along the glyph boundary the moving mask clips dots into
// partial (non-3x3) fragments.
//
// union-erase: erase every pixel covered by ANY solid k×k dark block. Interior
// dots of both layers vanish; only the clipped fragments along the boundary
// survive — and they trace the glyph outline, from a single frame.

export const W = 1280;
export const H = 720;

const MATCH_SET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const S = 48; // template normalization grid

// ---------------- binary morphology ----------------
export function dilateBin(m, w, h, k) {
  const r = k >> 1, out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue;
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) out[yy * w + xx] = 1;
  }
  return out;
}

function erodeBin(m, w, h, k) {
  const r = k >> 1, out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let ok = 1;
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
    outer: for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      if (!m[yy * w + xx]) { ok = 0; break outer; }
    }
    out[y * w + x] = ok;
  }
  return out;
}

// ---------------- union-erase ----------------
// Returns { dark, interior } binary fields (W*H). The outline is dark & ~interior.
export function unionErase(imgData, thr, period) {
  const d = imgData.data, k = Math.max(2, Math.round(period / 2));
  const dark = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) dark[p] = d[i] < thr ? 1 : 0;

  // integral image for O(1) window sums
  const integ = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let rs = 0;
    for (let x = 0; x < W; x++) {
      rs += dark[y * W + x];
      integ[(y + 1) * (W + 1) + x + 1] = integ[y * (W + 1) + x + 1] + rs;
    }
  }
  const r = k >> 1, kk = k * k;
  const solid = new Uint8Array(W * H);
  for (let y = r; y < H - (k - r - 1); y++) {
    for (let x = r; x < W - (k - r - 1); x++) {
      const x0 = x - r, y0 = y - r, x1 = x0 + k, y1 = y0 + k;
      const s = integ[y1 * (W + 1) + x1] - integ[y0 * (W + 1) + x1]
              - integ[y1 * (W + 1) + x0] + integ[y0 * (W + 1) + x0];
      if (s === kk) solid[y * W + x] = 1;
    }
  }
  const interior = dilateBin(solid, W, H, k);
  return { dark, interior };
}

export function outlineMask(dark, interior) {
  const m = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) m[p] = dark[p] && !interior[p] ? 1 : 0;
  return m;
}

// ---------------- outline templates ----------------
let TPLS = null;

export async function ensureFont() {
  try { await document.fonts.load('900 100px "Arial Black"'); } catch {}
}

function outlineTemplate(ch, capH = 200) {
  const pad = 20;
  const c = document.createElement('canvas');
  let ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.font = `${capH}px "Arial Black", "Arial Bold", Arial, sans-serif`;
  const tw = Math.ceil(ctx.measureText(ch).width);
  c.width = tw + pad * 2; c.height = capH + pad * 2;
  ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.font = `${capH}px "Arial Black", "Arial Bold", Arial, sans-serif`;
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'top';
  ctx.fillText(ch, pad, pad);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const w = c.width, h = c.height;
  const m = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) m[p] = id.data[i] > 127 ? 1 : 0;

  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (m[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1, chh = y1 - y0 + 1;
  const crop = new Uint8Array(cw * chh);
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) crop[y * cw + x] = m[(y0 + y) * w + (x0 + x)];

  // morphological gradient -> boundary only (keeps inner contours of O, A, ...)
  const dil = dilateBin(crop, cw, chh, 3), ero = erodeBin(crop, cw, chh, 3);
  const grad = new Uint8Array(cw * chh);
  for (let p = 0; p < cw * chh; p++) grad[p] = dil[p] && !ero[p] ? 1 : 0;
  return { m: grad, w: cw, h: chh };
}

function normBin(m, w, h, size = S) {
  const out = new Float32Array(size * size);
  const sc = Math.min(size / w, size / h) * 0.92;
  const nw = Math.max(1, Math.round(w * sc)), nh = Math.max(1, Math.round(h * sc));
  const ox = (size - nw) >> 1, oy = (size - nh) >> 1;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const sx = Math.min(w - 1, Math.round(x / sc)), sy = Math.min(h - 1, Math.round(y / sc));
    out[(oy + y) * size + (ox + x)] = m[sy * w + sx];
  }
  return out;
}

export function buildTemplates() {
  if (TPLS) return TPLS;
  TPLS = [];
  for (const ch of MATCH_SET) {
    const t = outlineTemplate(ch, 200);
    if (!t) continue;
    const thick = dilateBin(t.m, t.w, t.h, 3);
    TPLS.push({ ch, v: normBin(thick, t.w, t.h) });
  }
  return TPLS;
}

function ncc(a, b) {
  let ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
  ma /= a.length; mb /= a.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return num / (Math.sqrt(da * db) + 1e-9);
}

// ---------------- OCR ----------------
function findRowBands(outline) {
  const thick = dilateBin(outline, W, H, 9);
  const rows = new Float64Array(H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rows[y] += thick[y * W + x];
  // zero the structural residue bands where dot layers enter/leave the canvas
  const edge = 60;
  for (let y = 0; y < edge; y++) { rows[y] = 0; rows[H - 1 - y] = 0; }
  let mx = 0; for (const v of rows) if (v > mx) mx = v;
  const on = rows.map(v => v > mx * 0.05);
  const bands = []; let s = -1;
  for (let y = 0; y < H; y++) {
    if (on[y] && s < 0) s = y;
    if (!on[y] && s >= 0) { if (y - s > 60) bands.push([s, y]); s = -1; }
  }
  if (s >= 0 && H - s > 60) bands.push([s, H]);
  return bands;
}

function ocrLine(outline, y0, y1, tpls) {
  const lh = y1 - y0;
  const cols = new Float64Array(W);
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) cols[x] += outline[y * W + x];
  // segment on the RAW outline so adjacent letters keep their gap
  const segs = []; let s = -1;
  for (let x = 0; x < W; x++) {
    if (cols[x] > 0 && s < 0) s = x;
    if (cols[x] === 0 && s >= 0) { segs.push([s, x]); s = -1; }
  }
  if (s >= 0) segs.push([s, W]);
  // merge fragments separated by tiny gaps (within one stroke)
  const merged = [];
  for (const sg of segs) {
    if (merged.length && sg[0] - merged[merged.length - 1][1] < lh * 0.10)
      merged[merged.length - 1][1] = sg[1];
    else merged.push([sg[0], sg[1]]);
  }
  // drop isolated narrow fragments (noise / residue)
  const widths = merged.map(([a, b]) => b - a).sort((a, b) => a - b);
  if (widths.length) {
    const med = widths[widths.length >> 1];
    for (let i = merged.length - 1; i >= 0; i--)
      if (merged[i][1] - merged[i][0] <= Math.max(8, med * 0.25)) merged.splice(i, 1);
  }
  const chars = []; let prevEnd = null;
  for (const [x0, x1] of merged) {
    if (prevEnd !== null && x0 - prevEnd > lh * 0.45) chars.push({ ch: ' ', box: null });
    let cy0 = y1, cy1 = y0 - 1;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++)
      if (outline[y * W + x]) { if (y < cy0) cy0 = y; if (y > cy1) cy1 = y; }
    if (cy1 < cy0) continue;
    const cw = x1 - x0, chh = cy1 - cy0 + 1;
    const crop = new Uint8Array(cw * chh);
    for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++)
      crop[y * cw + x] = outline[(cy0 + y) * W + (x0 + x)];
    const thick = dilateBin(crop, cw, chh, 5);
    const v = normBin(thick, cw, chh);
    let best = '', bc = -2;
    for (const t of tpls) { const c = ncc(v, t.v); if (c > bc) { bc = c; best = t.ch; } }
    chars.push({ ch: best, score: bc, box: [x0, cy0, x1, cy1 + 1] });
    prevEnd = x1;
  }
  return chars;
}

export function ocrFrame(dark, interior) {
  const tpls = buildTemplates();
  const outline = outlineMask(dark, interior);
  const bands = findRowBands(outline);
  const lines = [], boxes = [];
  for (const [y0, y1] of bands) {
    const chars = ocrLine(outline, y0, y1, tpls);
    lines.push(chars.map(c => c.ch).join(''));
    for (const c of chars) if (c.box) boxes.push({ box: c.box, ch: c.ch, score: c.score });
  }
  return { lines, boxes };
}

// Per-position majority vote across frames. "No character at this position"
// casts an explicit vote too, so a space (or absent) cannot be filled by a
// minority of frames whose segmentation produced a spurious fragment there.
export function voteResults(perFrame) {
  const nLines = Math.max(...perFrame.map(r => r.lines.length));
  const out = [];
  for (let li = 0; li < nLines; li++) {
    const lines = perFrame.map(r => r.lines[li] ?? '');
    const maxLen = Math.max(...lines.map(s => s.length));
    let line = '';
    for (let p = 0; p < maxLen; p++) {
      const cnt = {};
      for (const s of lines) { const c = s[p] ?? ''; cnt[c] = (cnt[c] || 0) + 1; }
      let best = '', bn = 0;
      for (const [c, n] of Object.entries(cnt)) if (n > bn) { bn = n; best = c; }
      line += best;
    }
    out.push(line.replace(/ +/g, ' ').trim());
  }
  return out;
}
