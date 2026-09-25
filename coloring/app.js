/* Snap & Color — photo → outline → tap-to-color, with a note per color. */
'use strict';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const LINE_WIDTH = 2.6; // stroke width in image pixels at a 480px working size

// Neural line-art model (Informative Drawings, MIT licence) run in the browser with ONNX Runtime.
const MODEL_URL = 'model/informative_drawings.onnx';
const ORT_CDN = window.SNAP_ORT_BASE || 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';
// Per detail level: model working size (long side), ink threshold on the model output
// pre-blur, hysteresis thresholds on the model output, and cleanup sizes.
const MODEL_DETAIL = {
  1: { side: 384, blur: 2.2, low: 0.70, high: 0.40, closeR: 1, minInk: 10, spur: 6, bridge: 8, reach: 20, minStroke: 24, minSpace: 50 },
  2: { side: 448, blur: 1.6, low: 0.75, high: 0.45, closeR: 1, minInk: 8, spur: 5, bridge: 7, reach: 18, minStroke: 20, minSpace: 40 },
  3: { side: 512, blur: 1.2, low: 0.75, high: 0.45, closeR: 1, minInk: 8, spur: 5, bridge: 7, reach: 16, minStroke: 16, minSpace: 32 },
  4: { side: 512, blur: 0.8, low: 0.85, high: 0.55, closeR: 1, minInk: 6, spur: 4, bridge: 6, reach: 14, minStroke: 12, minSpace: 26 },
  5: { side: 576, blur: 0, low: 0.90, high: 0.60, closeR: 1, minInk: 6, spur: 4, bridge: 6, reach: 12, minStroke: 10, minSpace: 20 },
};

// Detail levels 1..5: working size, smoothing, line scale (sigmaC), stroke coherence
// (sigmaM), how much of the page gets inked (inkFrac), and cleanup sizes.
const DETAIL = {
  1: { side: 360, sigmaR: 34, smoothPasses: 3, etfRadius: 5, sigmaC: 1.3, sigmaM: 4.5, inkFrac: 0.035, passes: 2, closeR: 2, minInk: 12, spur: 8, bridge: 10, reach: 28, K: 3, fenceGap: 5, minStroke: 22, minSpace: 60 },
  2: { side: 420, sigmaR: 30, smoothPasses: 3, etfRadius: 5, sigmaC: 1.2, sigmaM: 4.0, inkFrac: 0.050, passes: 2, closeR: 2, minInk: 10, spur: 7, bridge: 9, reach: 26, K: 4, fenceGap: 5, minStroke: 20, minSpace: 50 },
  3: { side: 480, sigmaR: 26, smoothPasses: 2, etfRadius: 5, sigmaC: 1.1, sigmaM: 4.0, inkFrac: 0.065, passes: 2, closeR: 2, minInk: 10, spur: 6, bridge: 8, reach: 24, K: 4, fenceGap: 4, minStroke: 16, minSpace: 40 },
  4: { side: 560, sigmaR: 22, smoothPasses: 2, etfRadius: 4, sigmaC: 1.0, sigmaM: 3.5, inkFrac: 0.080, passes: 2, closeR: 2, minInk: 8, spur: 6, bridge: 8, reach: 22, K: 5, fenceGap: 4, minStroke: 13, minSpace: 34 },
  5: { side: 640, sigmaR: 18, smoothPasses: 1, etfRadius: 4, sigmaC: 1.0, sigmaM: 3.0, inkFrac: 0.100, passes: 1, closeR: 1, minInk: 8, spur: 5, bridge: 7, reach: 20, K: 6, fenceGap: 4, minStroke: 10, minSpace: 28 },
};

// Palette: each color has its own note (A-minor pentatonic, low → high).
const PALETTE = [
  { name: 'black',      hex: '#2b2b2b', freq: 220.00 }, // A3
  { name: 'brown',      hex: '#8d5524', freq: 261.63 }, // C4
  { name: 'red',        hex: '#e63946', freq: 293.66 }, // D4
  { name: 'orange',     hex: '#f77f00', freq: 329.63 }, // E4
  { name: 'yellow',     hex: '#fcbf49', freq: 392.00 }, // G4
  { name: 'lime',       hex: '#a7c957', freq: 440.00 }, // A4
  { name: 'teal',       hex: '#2a9d8f', freq: 523.25 }, // C5
  { name: 'sky',        hex: '#4cc9f0', freq: 587.33 }, // D5
  { name: 'blue',       hex: '#4361ee', freq: 659.25 }, // E5
  { name: 'purple',     hex: '#7209b7', freq: 783.99 }, // G5
  { name: 'pink',       hex: '#f72585', freq: 880.00 }, // A5
  { name: 'blush',      hex: '#ffafcc', freq: 1046.50 }, // C6
  { name: 'eraser',     hex: '#ffffff', freq: 0, eraser: true },
];
const BLANK = '#ffffff';
const INK = '#1a1a1a';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const el = {
  stage: $('#stage'), empty: $('#empty'), svgHost: $('#svgHost'),
  busy: $('#busy'), busyText: $('#busyText'),
  controls: $('#controls'), footer: $('#footer'),
  cameraInput: $('#cameraInput'), fileInput: $('#fileInput'), sampleBtn: $('#sampleBtn'),
  detail: $('#detail'), regenBtn: $('#regenBtn'), fitBtn: $('#fitBtn'),
  palette: $('#palette'), undoBtn: $('#undoBtn'), clearBtn: $('#clearBtn'),
  soundBtn: $('#soundBtn'), svgBtn: $('#svgBtn'), saveBtn: $('#saveBtn'),
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  image: null,        // HTMLImageElement of the source photo
  W: 0, H: 0,         // traced size
  svg: null,          // <svg> element
  regions: [],        // [{el, area}]
  undo: [],           // [[{el, prev}], ...]
  color: PALETTE[2],
  soundOn: true,
  view: null,         // current viewBox {x,y,w,h}
};

// ---------------------------------------------------------------------------
// Image processing: bilateral smooth → edge tangent flow → flow-guided DoG lines
// (Kang, Lee & Chui, "Coherent Line Drawing") → closed spaces between the lines
// ---------------------------------------------------------------------------

// Edge-preserving smoothing: washes out texture, keeps object boundaries.
function bilateral(data, W, H, radius, sigmaS, sigmaR, passes) {
  const n = W * H;
  let src = new Float32Array(n * 3);
  for (let i = 0, j = 0; i < n; i++, j += 4) { src[i * 3] = data[j]; src[i * 3 + 1] = data[j + 1]; src[i * 3 + 2] = data[j + 2]; }
  const spatial = new Float32Array((2 * radius + 1) * (2 * radius + 1));
  for (let dy = -radius, k = 0; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++, k++) spatial[k] = Math.exp(-(dx * dx + dy * dy) / (2 * sigmaS * sigmaS));
  const range = new Float32Array(766);
  for (let d = 0; d < 766; d++) range[d] = Math.exp(-(d * d) / (2 * (sigmaR * 3) * (sigmaR * 3)));
  for (let pass = 0; pass < passes; pass++) {
    const out = new Float32Array(n * 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        const r0 = src[i], g0 = src[i + 1], b0 = src[i + 2];
        let wr = 0, wg = 0, wb = 0, ws = 0, k = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) { k += 2 * radius + 1; continue; }
          for (let dx = -radius; dx <= radius; dx++, k++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            const j = (yy * W + xx) * 3;
            const r = src[j], g = src[j + 1], b = src[j + 2];
            const d = (Math.abs(r - r0) + Math.abs(g - g0) + Math.abs(b - b0)) | 0;
            const w = spatial[k] * range[d];
            wr += r * w; wg += g * w; wb += b * w; ws += w;
          }
        }
        out[i] = wr / ws; out[i + 1] = wg / ws; out[i + 2] = wb / ws;
      }
    }
    src = out;
  }
  return src;
}

function gaussianBlur(src, W, H, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) { let xx = x + i; if (xx < 0) xx = 0; else if (xx >= W) xx = W - 1; acc += src[y * W + xx] * k[i + r]; }
    tmp[y * W + x] = acc;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) { let yy = y + i; if (yy < 0) yy = 0; else if (yy >= H) yy = H - 1; acc += tmp[yy * W + x] * k[i + r]; }
    out[y * W + x] = acc;
  }
  return out;
}

// Edge tangent flow: a smooth vector field that runs along the picture's edges.
function edgeTangentFlow(gray, W, H, radius, iters) {
  const n = W * H;
  const b = gaussianBlur(gray, W, H, 1.0);
  let tx = new Float32Array(n), ty = new Float32Array(n);
  const mag = new Float32Array(n);
  let maxMag = 1e-6;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const xl = x > 0 ? i - 1 : i, xr = x < W - 1 ? i + 1 : i, yu = y > 0 ? i - W : i, yd = y < H - 1 ? i + W : i;
    const gx = (b[xr] - b[xl]) * 0.5, gy = (b[yd] - b[yu]) * 0.5;
    const m = Math.sqrt(gx * gx + gy * gy);
    mag[i] = m; if (m > maxMag) maxMag = m;
    if (m > 1e-6) { tx[i] = -gy / m; ty[i] = gx / m; } else { tx[i] = 0; ty[i] = 0; }
  }
  for (let i = 0; i < n; i++) mag[i] /= maxMag;
  const pass = (sx, sy, horizontal) => {
    const ox = new Float32Array(n), oy = new Float32Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const cx = sx[i], cy = sy[i], cm = mag[i];
      let ax = 0, ay = 0;
      for (let d = -radius; d <= radius; d++) {
        let xx = x, yy = y;
        if (horizontal) { xx += d; if (xx < 0 || xx >= W) continue; } else { yy += d; if (yy < 0 || yy >= H) continue; }
        const j = yy * W + xx;
        const dot = cx * sx[j] + cy * sy[j];
        const wm = (1 + Math.tanh(mag[j] - cm)) * 0.5;
        const w = (dot >= 0 ? 1 : -1) * Math.abs(dot) * wm;
        ax += sx[j] * w; ay += sy[j] * w;
      }
      const len = Math.sqrt(ax * ax + ay * ay);
      if (len > 1e-6) { ox[i] = ax / len; oy[i] = ay / len; } else { ox[i] = cx; oy[i] = cy; }
    }
    return [ox, oy];
  };
  for (let it = 0; it < iters; it++) {
    [tx, ty] = pass(tx, ty, true);
    [tx, ty] = pass(tx, ty, false);
  }
  return { tx, ty };
}

// Flow-guided difference of Gaussians. Returns a line strength map: 1 = paper, 0 = ink.
function flowDoG(gray, W, H, flow, p) {
  const { tx, ty } = flow;
  const n = W * H;
  const sigC = p.sigmaC, sigS = p.sigmaC * 1.6, sigM = p.sigmaM;
  const T = Math.ceil(sigS * 2.5), S = Math.ceil(sigM * 2.0);
  const dog = new Float32Array(2 * T + 1);
  let sc = 0, ss = 0;
  for (let t = -T; t <= T; t++) { sc += Math.exp(-(t * t) / (2 * sigC * sigC)); ss += Math.exp(-(t * t) / (2 * sigS * sigS)); }
  for (let t = -T; t <= T; t++) dog[t + T] = Math.exp(-(t * t) / (2 * sigC * sigC)) / sc - p.rho * Math.exp(-(t * t) / (2 * sigS * sigS)) / ss;
  const gm = new Float32Array(S + 1);
  for (let s = 0; s <= S; s++) gm[s] = Math.exp(-(s * s) / (2 * sigM * sigM));
  const sample = (fx, fy) => {
    let x = fx | 0, y = fy | 0;
    if (x < 0) x = 0; else if (x >= W) x = W - 1;
    if (y < 0) y = 0; else if (y >= H) y = H - 1;
    return gray[y * W + x];
  };
  // F(p): DoG across the edge, sampled along the gradient direction at p.
  const across = (px, py) => {
    let ix = px | 0, iy = py | 0;
    if (ix < 0) ix = 0; else if (ix >= W) ix = W - 1;
    if (iy < 0) iy = 0; else if (iy >= H) iy = H - 1;
    const j = iy * W + ix;
    const dx = ty[j], dy = -tx[j];
    let acc = 0;
    for (let t = -T; t <= T; t++) acc += sample(px + dx * t, py + dy * t) * dog[t + T];
    return acc;
  };
  const out = new Float32Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let sum = across(x + 0.5, y + 0.5) * gm[0], wsum = gm[0];
    for (let dir = -1; dir <= 1; dir += 2) {
      let px = x + 0.5, py = y + 0.5;
      let vx = tx[i] * dir, vy = ty[i] * dir;
      for (let s = 1; s <= S; s++) {
        px += vx; py += vy;
        if (px < 0 || py < 0 || px >= W || py >= H) break;
        const j = (py | 0) * W + (px | 0);
        let nx = tx[j], ny = ty[j];
        if (nx * vx + ny * vy < 0) { nx = -nx; ny = -ny; }
        if (nx === 0 && ny === 0) break;
        vx = nx; vy = ny;
        sum += across(px, py) * gm[s]; wsum += gm[s];
      }
    }
    out[i] = sum / wsum; // negative = ink side
  }
  return out;
}

// sRGB → CIE Lab (D65). Lightness is weighted down a little so shading
// splits a surface less often than a real change of color does.
function rgbToLab(rgb, n) {
  const lab = new Float32Array(n * 3);
  const lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; lin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  for (let i = 0; i < n; i++) {
    const r = lin[Math.round(rgb[i * 3]) | 0], g = lin[Math.round(rgb[i * 3 + 1]) | 0], b = lin[Math.round(rgb[i * 3 + 2]) | 0];
    const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    const Y = (r * 0.2126 + g * 0.7152 + b * 0.0722);
    const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const fx = f(X), fy = f(Y), fz = f(Z);
    lab[i * 3] = (116 * fy - 16) * 0.7;
    lab[i * 3 + 1] = 500 * (fx - fy);
    lab[i * 3 + 2] = 200 * (fy - fz);
  }
  return lab;
}

// k-means (k-means++ seeding) on a pixel sample, then label every pixel.
function kmeansLabels(lab, n, K, iters) {
  const sampleN = Math.min(n, 24000);
  const step = Math.max(1, Math.floor(n / sampleN));
  const sample = [];
  for (let i = 0; i < n; i += step) sample.push(i);
  const S = sample.length;
  const cent = new Float32Array(K * 3);
  let rnd = 12345;
  const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  // k-means++ seeding
  const d2 = new Float32Array(S).fill(Infinity);
  let first = sample[(rand() * S) | 0];
  cent[0] = lab[first * 3]; cent[1] = lab[first * 3 + 1]; cent[2] = lab[first * 3 + 2];
  for (let c = 1; c < K; c++) {
    let total = 0;
    for (let s = 0; s < S; s++) {
      const p = sample[s] * 3, q = (c - 1) * 3;
      const d = (lab[p] - cent[q]) ** 2 + (lab[p + 1] - cent[q + 1]) ** 2 + (lab[p + 2] - cent[q + 2]) ** 2;
      if (d < d2[s]) d2[s] = d;
      total += d2[s];
    }
    let r = rand() * total, pick = S - 1;
    for (let s = 0; s < S; s++) { r -= d2[s]; if (r <= 0) { pick = s; break; } }
    const p = sample[pick] * 3;
    cent[c * 3] = lab[p]; cent[c * 3 + 1] = lab[p + 1]; cent[c * 3 + 2] = lab[p + 2];
  }
  const sums = new Float32Array(K * 3), counts = new Int32Array(K);
  const assign = new Uint8Array(S);
  for (let it = 0; it < iters; it++) {
    sums.fill(0); counts.fill(0);
    for (let s = 0; s < S; s++) {
      const p = sample[s] * 3;
      let best = 0, bd = Infinity;
      for (let c = 0; c < K; c++) {
        const q = c * 3;
        const d = (lab[p] - cent[q]) ** 2 + (lab[p + 1] - cent[q + 1]) ** 2 + (lab[p + 2] - cent[q + 2]) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      assign[s] = best;
      sums[best * 3] += lab[p]; sums[best * 3 + 1] += lab[p + 1]; sums[best * 3 + 2] += lab[p + 2]; counts[best]++;
    }
    for (let c = 0; c < K; c++) if (counts[c]) { cent[c * 3] = sums[c * 3] / counts[c]; cent[c * 3 + 1] = sums[c * 3 + 1] / counts[c]; cent[c * 3 + 2] = sums[c * 3 + 2] / counts[c]; }
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 3;
    let best = 0, bd = Infinity;
    for (let c = 0; c < K; c++) {
      const q = c * 3;
      const d = (lab[p] - cent[q]) ** 2 + (lab[p + 1] - cent[q + 1]) ** 2 + (lab[p + 2] - cent[q + 2]) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    out[i] = best;
  }
  return out;
}

// 3×3 majority vote on cluster ids: rounds off jaggies and speckle.
function modeFilter(cls, W, H, K, passes) {
  let a = cls;
  const counts = new Int32Array(K);
  for (let pass = 0; pass < passes; pass++) {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        counts.fill(0);
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= W) continue;
            counts[a[yy * W + xx]]++;
          }
        }
        const me = a[y * W + x];
        let best = me, bc = counts[me];
        for (let c = 0; c < K; c++) if (counts[c] > bc) { bc = counts[c]; best = c; }
        out[y * W + x] = best;
      }
    }
    a = out;
  }
  return a;
}

// Fold weak components into the neighbour they touch most. A component is weak when it is
// tiny, an island enclosed by a single neighbour, or a long thin streak (texture, grain).
function mergeSmall(lab, W, H, count, areas, opts) {
  const { minArea, islandArea, sliverArea, sliverRatio } = opts;
  const n = W * H;
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const area = Float64Array.from(areas);
  const perim = new Float64Array(count);
  const touch = new Map();
  const nbrs = new Map();
  for (let pass = 0; pass < 10; pass++) {
    touch.clear(); nbrs.clear(); perim.fill(0);
    const bump = (a, b) => {
      const key = a * count + b;
      touch.set(key, (touch.get(key) || 0) + 1);
      let s = nbrs.get(a); if (!s) { s = new Set(); nbrs.set(a, s); } s.add(b);
    };
    for (let i = 0; i < n; i++) {
      const a = find(lab[i]);
      const x = i % W, y = (i - x) / W;
      if (x === 0 || x === W - 1) perim[a]++;
      if (y === 0 || y === H - 1) perim[a]++;
      if (x < W - 1) { const b = find(lab[i + 1]); if (a !== b) { perim[a]++; perim[b]++; bump(a, b); bump(b, a); } }
      if (y < H - 1) { const b = find(lab[i + W]); if (a !== b) { perim[a]++; perim[b]++; bump(a, b); bump(b, a); } }
    }
    const weak = [];
    for (let a = 0; a < count; a++) {
      if (find(a) !== a || !nbrs.has(a)) continue;
      const A = area[a];
      const isSmall = A < minArea;
      const isIsland = nbrs.get(a).size === 1 && A < islandArea;
      const isSliver = A < sliverArea && (perim[a] * perim[a]) / (4 * Math.PI * A) > sliverRatio;
      if (isSmall || isIsland || isSliver) weak.push(a);
    }
    if (!weak.length) break;
    weak.sort((p, q) => area[p] - area[q]);
    let merged = 0;
    for (const a of weak) {
      if (find(a) !== a) continue;
      let best = -1, bc = -1;
      for (const b0 of nbrs.get(a)) {
        const b = find(b0);
        if (b === a) continue;
        const c = touch.get(a * count + b0) || 0;
        if (c > bc) { bc = c; best = b; }
      }
      if (best === -1) continue;
      parent[a] = best;
      area[best] += area[a];
      merged++;
    }
    if (!merged) break;
  }
  // Compact labels.
  const remap = new Int32Array(count).fill(-1);
  const outAreas = [];
  let m = 0;
  for (let i = 0; i < n; i++) {
    const r = find(lab[i]);
    if (remap[r] === -1) { remap[r] = m++; outAreas.push(0); }
    lab[i] = remap[r];
    outAreas[lab[i]]++;
  }
  return { lab, count: m, areas: outAreas };
}

// Silhouette strokes from a coarse color segmentation, only where no drawn line is within
// `gap` pixels already. These close a subject's outline where the line drawing missed it.
function fenceLines(fence, sk, W, H, gap) {
  const n = W * H;
  const near = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!sk[i]) continue;
    const x = i % W, y = (i - x) / W;
    for (let dy = -gap; dy <= gap; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -gap; dx <= gap; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; near[yy * W + xx] = 1; } }
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = i % W;
    const border = (x < W - 1 && fence[i] !== fence[i + 1]) || (i < n - W && fence[i] !== fence[i + W]);
    if (border && !near[i]) out[i] = 1;
  }
  // Keep only fence pieces long enough to matter.
  const c = inkComponents(out, W, H);
  for (let i = 0; i < n; i++) if (out[i] && c.areas[c.lab[i]] < 30) out[i] = 0;
  return out;
}

// Morphological closing of a binary mask: bridges gaps up to ~2r pixels wide.
function morphClose(mask, W, H, r) {
  const n = W * H;
  const run = (src, want) => {
    let a = src;
    for (let pass = 0; pass < r; pass++) {
      const out = new Uint8Array(n);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let hit = a[i] === want;
        if (!hit) {
          hit = (x > 0 && a[i - 1] === want) || (x < W - 1 && a[i + 1] === want) || (y > 0 && a[i - W] === want) || (y < H - 1 && a[i + W] === want) ||
                (x > 0 && y > 0 && a[i - W - 1] === want) || (x < W - 1 && y > 0 && a[i - W + 1] === want) ||
                (x > 0 && y < H - 1 && a[i + W - 1] === want) || (x < W - 1 && y < H - 1 && a[i + W + 1] === want);
        }
        out[i] = hit ? want : 1 - want;
      }
      a = out;
    }
    return a;
  };
  return run(run(mask, 1), 0); // dilate ink, then erode it back
}

// Connected components of ink pixels with diagonal neighbours counted (8-connected).
function inkComponents(mask, W, H) {
  const n = W * H;
  const lab = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const areas = [];
  let next = 0;
  for (let s = 0; s < n; s++) {
    if (!mask[s] || lab[s] !== -1) continue;
    const L = next++;
    let sp = 0, area = 0;
    stack[sp++] = s; lab[s] = L;
    while (sp > 0) {
      const i = stack[--sp]; area++;
      const x = i % W, y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue;
          const j = yy * W + xx; if (mask[j] && lab[j] === -1) { lab[j] = L; stack[sp++] = j; } } }
    }
    areas.push(area);
  }
  return { lab, count: next, areas };
}

// Connected components of a label map (4-connected, equal values); returns labels and areas.
function components(mask, W, H) {
  const n = W * H;
  const lab = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const areas = [];
  let next = 0;
  for (let s = 0; s < n; s++) {
    if (lab[s] !== -1) continue;
    const L = next++, c = mask[s];
    let sp = 0, area = 0;
    stack[sp++] = s; lab[s] = L;
    while (sp > 0) {
      const i = stack[--sp]; area++;
      const x = i % W;
      if (x > 0 && lab[i - 1] === -1 && mask[i - 1] === c) { lab[i - 1] = L; stack[sp++] = i - 1; }
      if (x < W - 1 && lab[i + 1] === -1 && mask[i + 1] === c) { lab[i + 1] = L; stack[sp++] = i + 1; }
      if (i >= W && lab[i - W] === -1 && mask[i - W] === c) { lab[i - W] = L; stack[sp++] = i - W; }
      if (i < n - W && lab[i + W] === -1 && mask[i + W] === c) { lab[i + W] = L; stack[sp++] = i + W; }
    }
    areas.push(area);
  }
  return { lab, count: next, areas };
}

// ---- Single-width connected lines -------------------------------------------------

const NB8 = (W) => [1, -1, W, -W, W + 1, W - 1, -W + 1, -W - 1];

// Zhang–Suen thinning: reduces ink to a one-pixel-wide skeleton.
function thin(mask, W, H) {
  const a = Uint8Array.from(mask);
  let changed = true;
  const del = [];
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!a[i]) continue;
        const p2 = a[i - W], p3 = a[i - W + 1], p4 = a[i + 1], p5 = a[i + W + 1], p6 = a[i + W], p7 = a[i + W - 1], p8 = a[i - 1], p9 = a[i - W - 1];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        let A = 0;
        if (!p2 && p3) A++; if (!p3 && p4) A++; if (!p4 && p5) A++; if (!p5 && p6) A++;
        if (!p6 && p7) A++; if (!p7 && p8) A++; if (!p8 && p9) A++; if (!p9 && p2) A++;
        if (A !== 1) continue;
        if (step === 0) { if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue; }
        else { if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue; }
        del.push(i);
      }
      if (del.length) { changed = true; for (const i of del) a[i] = 0; }
    }
  }
  return a;
}

function degree8(a, W, H, i) {
  const x = i % W, y = (i - x) / W;
  let d = 0;
  for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
    for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const xx = x + dx; if (xx < 0 || xx >= W) continue; if (a[yy * W + xx]) d++; } }
  return d;
}

// Remove short hairs: branches shorter than `maxLen` that end at a junction.
function pruneSpurs(a, W, H, maxLen) {
  const n = W * H;
  for (let round = 0; round < 2; round++) {
    const ends = [];
    for (let i = 0; i < n; i++) if (a[i] && degree8(a, W, H, i) === 1) ends.push(i);
    for (const e of ends) {
      if (!a[e]) continue;
      const path = [e];
      let prev = -1, cur = e, ok = false;
      for (let step = 0; step < maxLen; step++) {
        const x = cur % W, y = (cur - x) / W;
        let next = -1, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const xx = x + dx; if (xx < 0 || xx >= W) continue;
            const j = yy * W + xx; if (a[j] && j !== prev && path.indexOf(j) === -1) { next = j; cnt++; } } }
        if (cnt === 0) break;               // isolated stub: leave it
        if (cnt >= 2 || degree8(a, W, H, next) >= 3) { ok = true; break; } // reached a junction
        prev = cur; cur = next; path.push(cur);
      }
      if (ok) for (const p of path) a[p] = 0;
    }
  }
  return a;
}

function drawLine(a, W, x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
  for (;;) {
    a[y0 * W + x0] = 1;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// Close gaps: every loose end first tries to continue straight ahead, then reaches for the
// nearest line pixel that is not part of its own stroke, then the picture edge if close.
function bridgeEnds(a, W, H, R, reach) {
  const n = W * H;
  const ends = [];
  for (let i = 0; i < n; i++) if (a[i] && degree8(a, W, H, i) === 1) ends.push(i);
  const own = new Set();
  const hitNear = (px, py) => {
    for (let dy = -1; dy <= 1; dy++) { const yy = py + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) { const xx = px + dx; if (xx < 0 || xx >= W) continue;
        const j = yy * W + xx; if (a[j] && !own.has(j)) return j; } }
    return -1;
  };
  for (const e of ends) {
    if (!a[e] || degree8(a, W, H, e) !== 1) continue;
    const ex = e % W, ey = (e - ex) / W;
    own.clear(); own.add(e);
    let cur = e, tail = e;
    for (let s = 0; s < reach + 4; s++) {
      const x = cur % W, y = (cur - x) / W;
      let next = -1;
      for (let dy = -1; dy <= 1 && next === -1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const xx = x + dx; if (xx < 0 || xx >= W) continue;
          const j = yy * W + xx; if (a[j] && !own.has(j)) { next = j; break; } } }
      if (next === -1) break;
      own.add(next); cur = next; if (s === 5) tail = cur;
    }
    if (tail === e) tail = cur;
    const tx = tail % W, ty = (tail - tx) / W;
    let vx = ex - tx, vy = ey - ty;
    const vl = Math.hypot(vx, vy);
    let done = false;
    if (vl > 0.5) {
      vx /= vl; vy /= vl;
      for (let s = 3; s <= reach; s++) {
        const px = Math.round(ex + vx * s), py = Math.round(ey + vy * s);
        if (px < 0 || py < 0 || px >= W || py >= H) {
          if (s <= R) { drawLine(a, W, ex, ey, Math.min(W - 1, Math.max(0, px)), Math.min(H - 1, Math.max(0, py))); done = true; }
          break;
        }
        const j = hitNear(px, py);
        if (j !== -1) { drawLine(a, W, ex, ey, j % W, (j - j % W) / W); done = true; break; }
      }
    }
    if (!done) {
      let best = -1, bd = R * R + 1;
      for (let dy = -R; dy <= R; dy++) { const yy = ey + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -R; dx <= R; dx++) { const xx = ex + dx; if (xx < 0 || xx >= W) continue;
          const j = yy * W + xx; if (!a[j] || own.has(j)) continue;
          const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = j; } } }
      if (best !== -1) { drawLine(a, W, ex, ey, best % W, (best - best % W) / W); done = true; }
    }
    if (!done) {
      const dl = ex, dr = W - 1 - ex, dt = ey, db = H - 1 - ey;
      const m = Math.min(dl, dr, dt, db);
      if (m <= R) {
        if (m === dl) drawLine(a, W, ex, ey, 0, ey); else if (m === dr) drawLine(a, W, ex, ey, W - 1, ey);
        else if (m === dt) drawLine(a, W, ex, ey, ex, 0); else drawLine(a, W, ex, ey, ex, H - 1);
      }
    }
  }
  return a;
}

// Spaces are the 4-connected paper pixels between skeleton lines. Tiny enclosed spaces are
// opened up by erasing the line around them (never filled with ink).
function spacesFromSkeleton(a, W, H, minSpace) {
  const n = W * H;
  for (let round = 0; round < 3; round++) {
    const c = components(a, W, H);
    let erased = 0;
    for (let i = 0; i < n; i++) {
      if (a[i] || c.areas[c.lab[i]] >= minSpace) continue;
      const x = i % W, y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue;
          const j = yy * W + xx; if (a[j]) { a[j] = 0; erased++; } } }
    }
    if (!erased) break;
  }
  const c = components(a, W, H);
  const lab = new Int32Array(n);
  const remap = new Int32Array(c.count).fill(-1);
  const areas = [0];
  let m = 1;
  for (let i = 0; i < n; i++) {
    if (a[i]) { lab[i] = 0; areas[0]++; continue; }
    const L = c.lab[i];
    if (remap[L] === -1) { remap[L] = m++; areas.push(0); }
    lab[i] = remap[L]; areas[lab[i]]++;
  }
  return { lab, count: m, areas };
}

// Link edge pixels into polylines (8-connected walks), drop short ones.
function edgeChains(edge, W, H, minLen) {
  const n = W * H;
  const seen = new Uint8Array(n);
  const chains = [];
  const nb = [1, -1, W, -W, W + 1, W - 1, -W + 1, -W - 1];
  const degree = (i) => {
    const x = i % W; let d = 0;
    for (let k = 0; k < 8; k++) {
      const j = i + nb[k]; if (j < 0 || j >= n) continue;
      const xj = j % W; if (Math.abs(xj - x) > 1) continue;
      if (edge[j]) d++;
    }
    return d;
  };
  const walk = (start) => {
    const pts = []; let cur = start;
    while (cur !== -1) {
      seen[cur] = 1; pts.push(cur % W + 0.5, ((cur / W) | 0) + 0.5);
      const x = cur % W; let next = -1;
      for (let k = 0; k < 8; k++) {
        const j = cur + nb[k]; if (j < 0 || j >= n) continue;
        if (Math.abs((j % W) - x) > 1) continue;
        if (edge[j] && !seen[j]) { next = j; break; }
      }
      cur = next;
    }
    return pts;
  };
  const collect = (pts) => { if (pts.length / 2 >= minLen) chains.push(pts); };
  for (let i = 0; i < n; i++) if (edge[i] && !seen[i] && degree(i) <= 1) collect(walk(i));
  for (let i = 0; i < n; i++) if (edge[i] && !seen[i]) collect(walk(i));
  return chains;
}

function simplifyOpen(pts, eps) {
  const m = pts.length / 2;
  const xs = new Array(m), ys = new Array(m);
  for (let i = 0; i < m; i++) { xs[i] = pts[2 * i]; ys[i] = pts[2 * i + 1]; }
  const keep = new Uint8Array(m); keep[0] = 1; keep[m - 1] = 1;
  rdp(xs, ys, keep, 0, m - 1, eps);
  const out = [];
  for (let i = 0; i < m; i++) if (keep[i]) out.push(xs[i], ys[i]);
  return out;
}

function chaikinOpen(pts) {
  const n = pts.length / 2;
  if (n < 3) return pts;
  const out = [pts[0], pts[1]];
  for (let i = 0; i < n - 1; i++) {
    const x0 = pts[2 * i], y0 = pts[2 * i + 1], x1 = pts[2 * i + 2], y1 = pts[2 * i + 3];
    out.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1, 0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1);
  }
  out.push(pts[2 * n - 2], pts[2 * n - 1]);
  return out;
}

function chainsToPath(chains) {
  let d = '';
  for (const pts of chains) {
    d += 'M' + fmt(pts[0]) + ' ' + fmt(pts[1]);
    for (let i = 2; i < pts.length; i += 2) d += 'L' + fmt(pts[i]) + ' ' + fmt(pts[i + 1]);
  }
  return d;
}

// Trace every label's boundary as closed loops on the pixel grid,
// then simplify. Returns an array (indexed by label) of loops (flat [x,y,...]).
function traceLabels(lab, W, H, count) {
  const W1 = W + 1;
  const V = W1 * (H + 1);
  const edgeLists = new Array(count);
  for (let L = 0; L < count; L++) edgeLists[L] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, L = lab[i];
      const list = edgeLists[L];
      const tl = y * W1 + x, tr = tl + 1, bl = tl + W1, br = bl + 1;
      if (y === 0 || lab[i - W] !== L) list.push(tl, tr);     // top, going right
      if (x === W - 1 || lab[i + 1] !== L) list.push(tr, br); // right, going down
      if (y === H - 1 || lab[i + W] !== L) list.push(br, bl); // bottom, going left
      if (x === 0 || lab[i - 1] !== L) list.push(bl, tl);     // left, going up
    }
  }
  const nextA = new Int32Array(V).fill(-1);
  const nextB = new Int32Array(V).fill(-1);
  const result = new Array(count);
  for (let L = 0; L < count; L++) {
    const list = edgeLists[L];
    for (let k = 0; k < list.length; k += 2) {
      const s = list[k], e = list[k + 1];
      if (nextA[s] === -1) nextA[s] = e; else nextB[s] = e;
    }
    const loops = [];
    for (let k = 0; k < list.length; k += 2) {
      const start = list[k];
      if (nextA[start] === -1) continue;
      const pts = [];
      let cur = start;
      do {
        pts.push(cur % W1, (cur / W1) | 0);
        const nx = nextA[cur];
        if (nx === -1) break;
        nextA[cur] = nextB[cur]; nextB[cur] = -1;
        cur = nx;
      } while (cur !== start);
      loops.push(chaikin(simplifyLoop(pts, 1.6), W, H));
    }
    result[L] = loops;
  }
  return result;
}

// Drop collinear points, then Ramer–Douglas–Peucker on the closed loop.
function simplifyLoop(flat, eps) {
  const n = flat.length / 2;
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) {
    const x = flat[2 * i], y = flat[2 * i + 1];
    const px = flat[2 * ((i + n - 1) % n)], py = flat[2 * ((i + n - 1) % n) + 1];
    const nx = flat[2 * ((i + 1) % n)], ny = flat[2 * ((i + 1) % n) + 1];
    if ((x - px) * (ny - y) - (y - py) * (nx - x) !== 0) { xs.push(x); ys.push(y); }
  }
  const m = xs.length;
  if (m <= 4) { const out = []; for (let i = 0; i < m; i++) out.push(xs[i], ys[i]); return out; }
  // Split the ring at the point farthest from point 0 so RDP sees two open chains.
  let far = 1, fd = -1;
  for (let i = 1; i < m; i++) { const d = (xs[i] - xs[0]) ** 2 + (ys[i] - ys[0]) ** 2; if (d > fd) { fd = d; far = i; } }
  const keep = new Uint8Array(m);
  keep[0] = 1; keep[far] = 1;
  rdp(xs, ys, keep, 0, far, eps);
  rdpWrap(xs, ys, keep, far, m, eps);
  const out = [];
  for (let i = 0; i < m; i++) if (keep[i]) out.push(xs[i], ys[i]);
  return out;
}

function rdp(xs, ys, keep, a, b, eps) {
  const stack = [[a, b]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    if (i1 - i0 < 2) continue;
    const x0 = xs[i0], y0 = ys[i0], x1 = xs[i1], y1 = ys[i1];
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
    let best = -1, bd = eps;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs(dy * (xs[i] - x0) - dx * (ys[i] - y0)) / len;
      if (d > bd) { bd = d; best = i; }
    }
    if (best !== -1) { keep[best] = 1; stack.push([i0, best], [best, i1]); }
  }
}
// Second chain runs from `far` back around to index 0 (index m ≡ 0).
function rdpWrap(xs, ys, keep, far, m, eps) {
  const idx = [];
  for (let i = far; i <= m; i++) idx.push(i % m);
  const sx = idx.map((i) => xs[i]), sy = idx.map((i) => ys[i]);
  const k = new Uint8Array(idx.length); k[0] = 1; k[idx.length - 1] = 1;
  rdp(sx, sy, k, 0, idx.length - 1, eps);
  for (let j = 1; j < idx.length - 1; j++) if (k[j]) keep[idx[j]] = 1;
}

// One round of Chaikin corner cutting: turns the polygon into a soft, hand-drawn line.
// Points on the picture's edge stay put so the outer corners remain square.
function chaikin(pts, W, H) {
  const n = pts.length / 2;
  if (n < 4) return pts;
  const onBorder = (x, y) => x === 0 || y === 0 || x === W || y === H;
  const out = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = pts[2 * i], y0 = pts[2 * i + 1], x1 = pts[2 * j], y1 = pts[2 * j + 1];
    if (onBorder(x0, y0)) out.push(x0, y0); else out.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1);
    if (onBorder(x1, y1)) out.push(x1, y1); else out.push(0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1);
  }
  return out;
}

const fmt = (v) => (Math.round(v * 10) / 10).toString();
function loopsToPath(loops) {
  let d = '';
  for (const pts of loops) {
    if (pts.length < 6) continue;
    d += 'M' + fmt(pts[0]) + ' ' + fmt(pts[1]);
    for (let i = 2; i < pts.length; i += 2) d += 'L' + fmt(pts[i]) + ' ' + fmt(pts[i + 1]);
    d += 'Z';
  }
  return d;
}

// Trace every label's boundary as closed loops on the pixel grid,
// then simplify. Returns an array (indexed by label) of loops (flat [x,y,...]).
function traceLabels(lab, W, H, count, eps) {
  const W1 = W + 1;
  const V = W1 * (H + 1);
  const edgeLists = new Array(count);
  for (let L = 0; L < count; L++) edgeLists[L] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, L = lab[i];
      const list = edgeLists[L];
      const tl = y * W1 + x, tr = tl + 1, bl = tl + W1, br = bl + 1;
      if (y === 0 || lab[i - W] !== L) list.push(tl, tr);     // top, going right
      if (x === W - 1 || lab[i + 1] !== L) list.push(tr, br); // right, going down
      if (y === H - 1 || lab[i + W] !== L) list.push(br, bl); // bottom, going left
      if (x === 0 || lab[i - 1] !== L) list.push(bl, tl);     // left, going up
    }
  }
  const nextA = new Int32Array(V).fill(-1);
  const nextB = new Int32Array(V).fill(-1);
  const result = new Array(count);
  for (let L = 0; L < count; L++) {
    const list = edgeLists[L];
    for (let k = 0; k < list.length; k += 2) {
      const s = list[k], e = list[k + 1];
      if (nextA[s] === -1) nextA[s] = e; else nextB[s] = e;
    }
    const loops = [];
    for (let k = 0; k < list.length; k += 2) {
      const start = list[k];
      if (nextA[start] === -1) continue;
      const pts = [];
      let cur = start;
      do {
        pts.push(cur % W1, (cur / W1) | 0);
        const nx = nextA[cur];
        if (nx === -1) break;
        nextA[cur] = nextB[cur]; nextB[cur] = -1;
        cur = nx;
      } while (cur !== start);
      loops.push(chaikin(simplifyLoop(pts, eps), W, H));
    }
    result[L] = loops;
  }
  return result;
}

// Drop collinear points, then Ramer–Douglas–Peucker on the closed loop.
function simplifyLoop(flat, eps) {
  const n = flat.length / 2;
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) {
    const x = flat[2 * i], y = flat[2 * i + 1];
    const px = flat[2 * ((i + n - 1) % n)], py = flat[2 * ((i + n - 1) % n) + 1];
    const nx = flat[2 * ((i + 1) % n)], ny = flat[2 * ((i + 1) % n) + 1];
    if ((x - px) * (ny - y) - (y - py) * (nx - x) !== 0) { xs.push(x); ys.push(y); }
  }
  const m = xs.length;
  if (m <= 4) { const out = []; for (let i = 0; i < m; i++) out.push(xs[i], ys[i]); return out; }
  let far = 1, fd = -1;
  for (let i = 1; i < m; i++) { const d = (xs[i] - xs[0]) ** 2 + (ys[i] - ys[0]) ** 2; if (d > fd) { fd = d; far = i; } }
  const keep = new Uint8Array(m);
  keep[0] = 1; keep[far] = 1;
  rdp(xs, ys, keep, 0, far, eps);
  rdpWrap(xs, ys, keep, far, m, eps);
  const out = [];
  for (let i = 0; i < m; i++) if (keep[i]) out.push(xs[i], ys[i]);
  return out;
}

function rdp(xs, ys, keep, a, b, eps) {
  const stack = [[a, b]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    if (i1 - i0 < 2) continue;
    const x0 = xs[i0], y0 = ys[i0], x1 = xs[i1], y1 = ys[i1];
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
    let best = -1, bd = eps;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs(dy * (xs[i] - x0) - dx * (ys[i] - y0)) / len;
      if (d > bd) { bd = d; best = i; }
    }
    if (best !== -1) { keep[best] = 1; stack.push([i0, best], [best, i1]); }
  }
}
function rdpWrap(xs, ys, keep, far, m, eps) {
  const idx = [];
  for (let i = far; i <= m; i++) idx.push(i % m);
  const sx = idx.map((i) => xs[i]), sy = idx.map((i) => ys[i]);
  const k = new Uint8Array(idx.length); k[0] = 1; k[idx.length - 1] = 1;
  rdp(sx, sy, k, 0, idx.length - 1, eps);
  for (let j = 1; j < idx.length - 1; j++) if (k[j]) keep[idx[j]] = 1;
}

// One round of Chaikin corner cutting; points on the picture's edge stay put.
function chaikin(pts, W, H) {
  const n = pts.length / 2;
  if (n < 4) return pts;
  const onBorder = (x, y) => x === 0 || y === 0 || x === W || y === H;
  const out = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = pts[2 * i], y0 = pts[2 * i + 1], x1 = pts[2 * j], y1 = pts[2 * j + 1];
    if (onBorder(x0, y0)) out.push(x0, y0); else out.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1);
    if (onBorder(x1, y1)) out.push(x1, y1); else out.push(0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1);
  }
  return out;
}

function loopsToPath(loops) {
  let d = '';
  for (const pts of loops) {
    if (pts.length < 6) continue;
    d += 'M' + fmt(pts[0]) + ' ' + fmt(pts[1]);
    for (let i = 2; i < pts.length; i += 2) d += 'L' + fmt(pts[i]) + ' ' + fmt(pts[i + 1]);
    d += 'Z';
  }
  return d;
}

// Classic tracer (no model): coherent line drawing on the smoothed photo.
function classicLines(data, W, H, cfg) {
  const n = W * H;
  const smooth = bilateral(data, W, H, 3, 2.0, cfg.sigmaR, cfg.smoothPasses);
  let gray = new Float32Array(n);
  for (let i = 0; i < n; i++) gray[i] = (0.299 * smooth[i * 3] + 0.587 * smooth[i * 3 + 1] + 0.114 * smooth[i * 3 + 2]) / 255;

  // Stretch contrast so faded or dark photos give the same line strength as crisp ones.
  {
    const sorted = Float32Array.from(gray).sort();
    const lo = sorted[Math.floor(n * 0.01)], hi = sorted[Math.floor(n * 0.99)];
    const span = Math.max(0.05, hi - lo);
    for (let i = 0; i < n; i++) gray[i] = Math.min(1, Math.max(0, (gray[i] - lo) / span));
  }

  const flow = edgeTangentFlow(gray, W, H, cfg.etfRadius, 3);
  const dogParams = { sigmaC: cfg.sigmaC, sigmaM: cfg.sigmaM, rho: 0.985 };
  let h = flowDoG(gray, W, H, flow, dogParams);
  // Auto exposure: choose the cutoff that inks about `inkFrac` of the picture,
  // but never draw responses weaker than a small floor (flat photos stay clean).
  const cutoffFor = (resp) => {
    const neg = [];
    for (let i = 0; i < n; i++) if (resp[i] < 0) neg.push(resp[i]);
    if (!neg.length) return -1;
    neg.sort((a, b) => a - b);
    const k = Math.min(neg.length - 1, Math.floor(cfg.inkFrac * n));
    return Math.min(neg[k], -0.004);
  };
  let cutoff = cutoffFor(h);
  for (let it = 1; it < cfg.passes; it++) {
    // Superimpose the lines onto the picture and go again: strokes grow more coherent.
    const phi = 0.55 / -cutoff;
    const g2 = new Float32Array(n);
    for (let i = 0; i < n; i++) g2[i] = Math.min(gray[i], h[i] < 0 ? 1 + Math.tanh(phi * h[i]) : 1);
    h = flowDoG(g2, W, H, flow, dogParams);
    cutoff = cutoffFor(h);
  }
  const lines = new Float32Array(n);
  for (let i = 0; i < n; i++) lines[i] = h[i] < cutoff ? 0 : 1;

  return lines;
}

// Hysteresis threshold on a line map (1 = paper): dark seeds (< high) grow along connected
// lighter stroke pixels (< low), so continuous outlines survive and faint texture does not.
function hysteresisInk(y, W, H, low, high) {
  const n = W * H;
  const ink = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  for (let i = 0; i < n; i++) if (y[i] < high) { ink[i] = 1; stack[sp++] = i; }
  while (sp > 0) {
    const i = stack[--sp], x = i % W, yy0 = (i - x) / W;
    for (let dy = -1; dy <= 1; dy++) { const yy = yy0 + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue;
        const j = yy * W + xx; if (!ink[j] && y[j] < low) { ink[j] = 1; stack[sp++] = j; } } }
  }
  return ink;
}

// ---------------------------------------------------------------------------
// Neural line art
// ---------------------------------------------------------------------------
let modelSession = null, modelLoading = null, modelFailed = false;

function loadModel(onStatus) {
  if (modelSession) return Promise.resolve(modelSession);
  if (modelLoading) return modelLoading;
  modelLoading = (async () => {
    if (typeof ort === 'undefined') throw new Error('ONNX Runtime did not load');
    ort.env.wasm.wasmPaths = ORT_CDN;
    onStatus('Loading drawing model (17 MB, first time only)…');
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error('model download failed: ' + res.status);
    const buf = await res.arrayBuffer();
    onStatus('Starting drawing model…');
    // ONNX Runtime tries execution providers in order and keeps the first that starts.
    const providers = navigator.gpu ? ['webgpu', 'wasm'] : ['wasm'];
    modelSession = await ort.InferenceSession.create(buf, { executionProviders: providers, graphOptimizationLevel: 'all' });
    return modelSession;
  })();
  modelLoading.catch(() => { modelFailed = true; modelLoading = null; });
  return modelLoading;
}

// Returns a line map (1 = paper, 0 = ink) at W×H from the model.
async function modelLines(data, W, H, session) {
  const n = W * H;
  const x = new Float32Array(3 * n);
  for (let i = 0, j = 0; i < n; i++, j += 4) { x[i] = data[j] / 255; x[n + i] = data[j + 1] / 255; x[2 * n + i] = data[j + 2] / 255; }
  const input = new ort.Tensor('float32', x, [1, 3, H, W]);
  const out = await session.run({ input });
  const y = out.output.data;
  const lines = new Float32Array(n);
  for (let i = 0; i < n; i++) lines[i] = Math.min(1, Math.max(0, y[i]));
  return lines;
}

// ---------------------------------------------------------------------------
// Pipeline: image → SVG
// ---------------------------------------------------------------------------
async function traceImage(img, detailLevel, onStatus) {
  let session = null;
  if (!modelFailed) {
    try { session = await loadModel(onStatus); }
    catch (err) { console.warn('Drawing model unavailable, using classic tracer', err); }
  }
  const useModel = !!session;
  const cfg = useModel ? (MODEL_DETAIL[detailLevel] || MODEL_DETAIL[2]) : (DETAIL[detailLevel] || DETAIL[3]);
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.min(1, cfg.side / Math.max(iw, ih));
  // The model wants sizes divisible by 8.
  const W = Math.max(64, Math.round(iw * s / 8) * 8), H = Math.max(64, Math.round(ih * s / 8) * 8);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  const n = W * H;

  let lines;
  if (useModel) {
    onStatus('Drawing…');
    // A light blur first keeps the model from drawing every hair and blade of grass.
    let src = data;
    if (cfg.blur > 0) {
      const blurred = new Uint8ClampedArray(data.length);
      for (let ch = 0; ch < 3; ch++) {
        const plane = new Float32Array(n);
        for (let i = 0; i < n; i++) plane[i] = data[i * 4 + ch];
        const b = gaussianBlur(plane, W, H, cfg.blur);
        for (let i = 0; i < n; i++) blurred[i * 4 + ch] = b[i];
      }
      src = blurred;
    }
    const y = await modelLines(src, W, H, session);
    const ink = hysteresisInk(y, W, H, cfg.low, cfg.high);
    lines = new Float32Array(n);
    for (let i = 0; i < n; i++) lines[i] = ink[i] ? 0 : 1;
  } else {
    lines = classicLines(data, W, H, cfg);
  }

  let ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) ink[i] = lines[i] === 0 ? 1 : 0;
  ink = morphClose(ink, W, H, cfg.closeR);
  {
    const c = inkComponents(ink, W, H);
    for (let i = 0; i < n; i++) if (ink[i] && c.areas[c.lab[i]] < cfg.minInk) ink[i] = 0;
  }
  let sk = thin(ink, W, H);
  sk = pruneSpurs(sk, W, H, cfg.spur);

  // Classic mode only: coarse color segmentation → silhouette strokes where lines left gaps.
  if (!useModel) {
  const smooth = bilateral(data, W, H, 3, 2.0, cfg.sigmaR, cfg.smoothPasses);
  const labc = rgbToLab(smooth, n);
  let cls = kmeansLabels(labc, n, cfg.K, 8);
  cls = modeFilter(cls, W, H, cfg.K, 2);
  const comp = components(cls, W, H);
  const fence = mergeSmall(comp.lab, W, H, comp.count, comp.areas, {
    minArea: 0.01 * n, islandArea: 0.03 * n, sliverArea: 0.03 * n, sliverRatio: 6,
  }).lab;
  const extra = fenceLines(fence, sk, W, H, cfg.fenceGap);
  for (let i = 0; i < n; i++) if (extra[i]) sk[i] = 1;
  sk = thin(sk, W, H);
  }

  sk = bridgeEnds(sk, W, H, cfg.bridge, cfg.reach);
  sk = pruneSpurs(sk, W, H, 3);
  {
    // Leftover short dashes that connected to nothing are dust: drop them.
    const c = inkComponents(sk, W, H);
    for (let i = 0; i < n; i++) if (sk[i] && c.areas[c.lab[i]] < cfg.minStroke) sk[i] = 0;
  }
  const { lab, count, areas } = spacesFromSkeleton(sk, W, H, cfg.minSpace);
  const loops = traceLabels(lab, W, H, count, 1.0);
  const chains = edgeChains(sk, W, H, 2).map((c) => chaikinOpen(simplifyOpen(c, 0.9)));

  const lw = fmt(LINE_WIDTH * Math.max(W, H) / 480);
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  parts.push('<g id="regions" fill-rule="evenodd" stroke-width="2" stroke-linejoin="round">');
  for (let L = 1; L < count; L++) {
    const d = loopsToPath(loops[L]);
    if (!d) continue;
    parts.push(`<path data-id="${L}" data-area="${areas[L]}" d="${d}" fill="${BLANK}" stroke="${BLANK}"/>`);
  }
  parts.push('</g>');
  parts.push(`<path id="ink" d="${chainsToPath(chains)}" fill="none" stroke="${INK}" stroke-width="${lw}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`);
  parts.push('</svg>');
  return { svgText: parts.join(''), W, H, regionCount: count - 1 };
}

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------
let audio = null, master = null;
function ensureAudio() {
  if (!audio) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audio = new AC();
    master = audio.createGain();
    master.gain.value = 0.6;
    master.connect(audio.destination);
  }
  if (audio.state === 'suspended') audio.resume();
  return audio;
}

function playColor(color, areaFrac) {
  if (!state.soundOn) return;
  const ac = ensureAudio();
  if (!ac) return;
  const t = ac.currentTime;
  const dur = 0.35 + Math.min(1, areaFrac * 12) * 0.9; // bigger spaces ring a little longer
  if (color.eraser) {
    // Soft "pff" for the eraser.
    const len = Math.floor(ac.sampleRate * 0.25);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = ac.createBufferSource(); src.buffer = buf;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.7;
    const g = ac.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(f).connect(g).connect(master);
    src.start(t); src.stop(t + 0.3);
    return;
  }
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(color.freq * 6, t);
  lp.frequency.exponentialRampToValueAtTime(color.freq * 1.5, t + dur);
  const o1 = ac.createOscillator(); o1.type = 'sine'; o1.frequency.value = color.freq;
  const o2 = ac.createOscillator(); o2.type = 'triangle'; o2.frequency.value = color.freq * 2; o2.detune.value = 4;
  const g2 = ac.createGain(); g2.gain.value = 0.22;
  o1.connect(lp); o2.connect(g2).connect(lp); lp.connect(g).connect(master);
  o1.start(t); o2.start(t);
  o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
}

// ---------------------------------------------------------------------------
// UI: palette
// ---------------------------------------------------------------------------
function buildPalette() {
  el.palette.innerHTML = '';
  PALETTE.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'swatch' + (c.eraser ? ' eraser' : '');
    b.title = c.name;
    b.setAttribute('aria-label', c.name);
    if (c.eraser) b.textContent = '⌫'; else b.style.background = c.hex;
    b.addEventListener('click', () => {
      ensureAudio();
      state.color = c;
      selectSwatch();
      playColor(c, 0.02);
    });
    c.button = b;
    el.palette.appendChild(b);
  });
  selectSwatch();
}
function selectSwatch() {
  PALETTE.forEach((c) => c.button.classList.toggle('selected', c === state.color));
}

// ---------------------------------------------------------------------------
// UI: fill, undo, clear
// ---------------------------------------------------------------------------
function fillRegion(path) {
  const color = state.color;
  const hex = color.eraser ? BLANK : color.hex;
  const prev = path.getAttribute('fill');
  if (prev === hex) { playColor(color, +path.dataset.area / (state.W * state.H)); return; }
  state.undo.push([{ el: path, prev }]);
  path.setAttribute('fill', hex);
  path.setAttribute('stroke', hex);
  playColor(color, +path.dataset.area / (state.W * state.H));
  if (navigator.vibrate) navigator.vibrate(8);
  color.button.classList.remove('ping'); void color.button.offsetWidth; color.button.classList.add('ping');
  updateButtons();
}
function undo() {
  const entry = state.undo.pop();
  if (!entry) return;
  for (const { el: p, prev } of entry) { p.setAttribute('fill', prev); p.setAttribute('stroke', prev); }
  updateButtons();
}
function clearAll() {
  const entry = [];
  for (const { el: p } of state.regions) {
    const prev = p.getAttribute('fill');
    if (prev !== BLANK) { entry.push({ el: p, prev }); p.setAttribute('fill', BLANK); p.setAttribute('stroke', BLANK); }
  }
  if (entry.length) state.undo.push(entry);
  updateButtons();
}
function updateButtons() {
  el.undoBtn.disabled = state.undo.length === 0;
}

// ---------------------------------------------------------------------------
// UI: zoom / pan / tap on the SVG
// ---------------------------------------------------------------------------
function setupInteraction(svg) {
  const pointers = new Map();
  let gesture = null; // {moved, multi, startX, startY, lastDist, lastMid}
  const svgPoint = (x, y) => {
    const m = svg.getScreenCTM();
    if (!m) return { x, y };
    const p = new DOMPoint(x, y).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const apply = () => {
    const v = state.view;
    svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  };
  const clampView = () => {
    const v = state.view, W = state.W, H = state.H;
    const maxW = W * 1.5, maxH = H * 1.5, minW = W / 12, minH = H / 12;
    if (v.w > maxW) { const k = maxW / v.w; v.w = maxW; v.h *= k; }
    if (v.w < minW) { const k = minW / v.w; v.w = minW; v.h *= k; }
    v.h = v.w * H / W;
    const slackX = v.w * 0.6, slackY = v.h * 0.6;
    v.x = Math.min(Math.max(v.x, -slackX), W - v.w + slackX);
    v.y = Math.min(Math.max(v.y, -slackY), H - v.h + slackY);
  };

  svg.addEventListener('pointerdown', (e) => {
    ensureAudio();
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      gesture = { moved: false, multi: false, startX: e.clientX, startY: e.clientY, target: e.target };
    } else if (pointers.size === 2) {
      gesture.multi = true;
      const [a, b] = [...pointers.values()];
      gesture.lastDist = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    e.preventDefault();
  });

  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const m = svg.getScreenCTM();
    const scale = m ? m.a : 1; // screen px per svg unit
    if (pointers.size === 1) {
      const dx = e.clientX - gesture.startX, dy = e.clientY - gesture.startY;
      if (!gesture.moved && Math.hypot(dx, dy) > 10) gesture.moved = true;
      if (gesture.moved) {
        state.view.x -= (e.clientX - prev.x) / scale;
        state.view.y -= (e.clientY - prev.y) / scale;
        clampView(); apply();
      }
    } else if (pointers.size === 2) {
      gesture.moved = true;
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = gesture.lastDist > 0 ? dist / gesture.lastDist : 1;
      const p = svgPoint(mid.x, mid.y);
      const v = state.view;
      v.x = p.x - (p.x - v.x) / k;
      v.y = p.y - (p.y - v.y) / k;
      v.w /= k; v.h /= k;
      v.x -= (mid.x - gesture.lastMid.x) / scale;
      v.y -= (mid.y - gesture.lastMid.y) / scale;
      gesture.lastDist = dist; gesture.lastMid = mid;
      clampView(); apply();
    }
  });

  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0 && gesture) {
      if (!gesture.moved && !gesture.multi) {
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const path = hit && hit.closest ? hit.closest('path[data-id]') : null;
        if (path) fillRegion(path);
      }
      gesture = null;
    }
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  // Mouse wheel zoom for desktop.
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = Math.exp(-e.deltaY * 0.0015);
    const p = svgPoint(e.clientX, e.clientY);
    const v = state.view;
    v.x = p.x - (p.x - v.x) / k;
    v.y = p.y - (p.y - v.y) / k;
    v.w /= k; v.h /= k;
    clampView(); apply();
  }, { passive: false });

  el.fitBtn.onclick = () => { state.view = { x: 0, y: 0, w: state.W, h: state.H }; apply(); };
}

// ---------------------------------------------------------------------------
// Load & trace
// ---------------------------------------------------------------------------
function setBusy(on, text) {
  el.busy.hidden = !on;
  if (text) el.busyText.textContent = text;
}

async function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  try { await loadImageURL(url); } finally { URL.revokeObjectURL(url); }
}

function loadImageURL(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { state.image = img; resolve(); };
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = url;
  });
}

async function retrace() {
  if (!state.image) return;
  setBusy(true, 'Tracing outline…');
  await new Promise((r) => setTimeout(r, 30)); // let the spinner paint
  try {
    const { svgText, W, H, regionCount } = await traceImage(state.image, +el.detail.value, (t) => setBusy(true, t));
    state.W = W; state.H = H;
    el.svgHost.innerHTML = svgText;
    const svg = el.svgHost.querySelector('svg');
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    state.svg = svg;
    state.regions = [...svg.querySelectorAll('path[data-id]')].map((p) => ({ el: p, area: +p.dataset.area }));
    state.undo = [];
    state.view = { x: 0, y: 0, w: W, h: H };
    setupInteraction(svg);
    el.empty.hidden = true;
    el.svgHost.hidden = false;
    el.controls.hidden = false;
    el.footer.hidden = false;
    updateButtons();
    if (regionCount === 0) alert('No spaces found — try more detail, or a photo with clearer shapes.');
  } catch (err) {
    console.error(err);
    alert('Sorry, tracing failed: ' + err.message);
  } finally {
    setBusy(false);
  }
}

async function handleFile(file) {
  if (!file) return;
  setBusy(true, 'Loading photo…');
  try { await loadImageFile(file); await retrace(); }
  catch (err) { setBusy(false); alert(err.message); }
}
el.cameraInput.addEventListener('change', (e) => { handleFile(e.target.files[0]); e.target.value = ''; });
el.fileInput.addEventListener('change', (e) => { handleFile(e.target.files[0]); e.target.value = ''; });
el.sampleBtn.addEventListener('click', async () => {
  setBusy(true, 'Loading sample…');
  try { await loadImageURL('../images2/20230619023713_00019.png'); await retrace(); }
  catch (err) { setBusy(false); alert(err.message); }
});
el.regenBtn.addEventListener('click', retrace);
el.detail.addEventListener('change', retrace);
el.undoBtn.addEventListener('click', undo);
el.clearBtn.addEventListener('click', clearAll);
el.soundBtn.addEventListener('click', () => {
  state.soundOn = !state.soundOn;
  el.soundBtn.textContent = state.soundOn ? '🔊' : '🔇';
  el.soundBtn.setAttribute('aria-pressed', String(state.soundOn));
  if (state.soundOn) { ensureAudio(); playColor(state.color, 0.02); }
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function exportSVGText() {
  const clone = state.svg.cloneNode(true);
  clone.setAttribute('viewBox', `0 0 ${state.W} ${state.H}`);
  clone.setAttribute('width', state.W); clone.setAttribute('height', state.H);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(clone);
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Snap & Color' }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  download(blob, name);
}
async function exportPNG() {
  if (!state.svg) return;
  const text = exportSVGText();
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.max(2, Math.ceil(1600 / Math.max(state.W, state.H)));
    const c = document.createElement('canvas');
    c.width = state.W * scale; c.height = state.H * scale;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    await shareOrDownload(blob, 'snap-and-color.png');
  } finally { URL.revokeObjectURL(url); }
}
el.saveBtn.addEventListener('click', exportPNG);
el.svgBtn.addEventListener('click', () => {
  if (!state.svg) return;
  download(new Blob([exportSVGText()], { type: 'image/svg+xml' }), 'snap-and-color.svg');
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
buildPalette();
updateButtons();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
// Expose for tests.
window.__snapColor = { traceImage, state, PALETTE };
