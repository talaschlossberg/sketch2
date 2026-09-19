/* Snap & Color — photo → outline → tap-to-color, with a note per color. */
'use strict';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
// Line thickness, in working-image pixels, at a 640px working size (scaled for smaller sizes).
const LINE_WIDTH = 2.6;          // shape outline
const DETAIL_WIDTH = 1.7;        // interior pen lines

// Detail levels 1..5 → working size, color groups, smoothing, smallest space, island/streak
// removal limits, edge sensitivity, shortest pen line
const DETAIL = {
  1: { side: 300, K: 3,  sigmaR: 40, minAreaFrac: 0.0200, islandFrac: 0.050, sliverFrac: 0.040, sliverRatio: 5,  edgeFrac: 0.008, minChain: 30 },
  2: { side: 360, K: 4,  sigmaR: 36, minAreaFrac: 0.0100, islandFrac: 0.035, sliverFrac: 0.030, sliverRatio: 6,  edgeFrac: 0.014, minChain: 26 },
  3: { side: 440, K: 5,  sigmaR: 32, minAreaFrac: 0.0050, islandFrac: 0.020, sliverFrac: 0.020, sliverRatio: 7,  edgeFrac: 0.022, minChain: 22 },
  4: { side: 540, K: 7,  sigmaR: 28, minAreaFrac: 0.0022, islandFrac: 0.008, sliverFrac: 0.010, sliverRatio: 9,  edgeFrac: 0.034, minChain: 18 },
  5: { side: 640, K: 10, sigmaR: 24, minAreaFrac: 0.0009, islandFrac: 0.003, sliverFrac: 0.004, sliverRatio: 12, edgeFrac: 0.050, minChain: 14 },
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
// Image processing: bilateral smooth → Lab k-means → clean up → merge slivers
// ---------------------------------------------------------------------------

// Edge-preserving smoothing: washes out texture, keeps object boundaries.
function bilateral(data, W, H, radius, sigmaS, sigmaR, passes) {
  const n = W * H;
  let src = new Float32Array(n * 3);
  for (let i = 0, j = 0; i < n; i++, j += 4) { src[i * 3] = data[j]; src[i * 3 + 1] = data[j + 1]; src[i * 3 + 2] = data[j + 2]; }
  const spatial = new Float32Array((2 * radius + 1) * (2 * radius + 1));
  for (let dy = -radius, k = 0; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++, k++) spatial[k] = Math.exp(-(dx * dx + dy * dy) / (2 * sigmaS * sigmaS));
  const range = new Float32Array(766); // sum of abs channel diffs 0..765
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

// Connected components (4-connected) of equal cluster id.
function components(cls, W, H) {
  const n = W * H;
  const lab = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const areas = [];
  let next = 0;
  for (let s = 0; s < n; s++) {
    if (lab[s] !== -1) continue;
    const L = next++, c = cls[s];
    let sp = 0, area = 0;
    stack[sp++] = s; lab[s] = L;
    while (sp > 0) {
      const i = stack[--sp]; area++;
      const x = i % W;
      if (x > 0 && lab[i - 1] === -1 && cls[i - 1] === c) { lab[i - 1] = L; stack[sp++] = i - 1; }
      if (x < W - 1 && lab[i + 1] === -1 && cls[i + 1] === c) { lab[i + 1] = L; stack[sp++] = i + 1; }
      if (i >= W && lab[i - W] === -1 && cls[i - W] === c) { lab[i - W] = L; stack[sp++] = i - W; }
      if (i < n - W && lab[i + W] === -1 && cls[i + W] === c) { lab[i + W] = L; stack[sp++] = i + W; }
    }
    areas.push(area);
  }
  return { lab, count: next, areas };
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

// ---- Interior pen lines: Canny edges on the smoothed image, linked into strokes ----
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

function cannyEdges(gray, W, H, sigma, edgeFrac) {
  const n = W * H;
  const b = gaussianBlur(gray, W, H, sigma);
  const mag = new Float32Array(n), dir = new Uint8Array(n);
  let maxMag = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const gx = -b[i - W - 1] - 2 * b[i - 1] - b[i + W - 1] + b[i - W + 1] + 2 * b[i + 1] + b[i + W + 1];
    const gy = -b[i - W - 1] - 2 * b[i - W] - b[i - W + 1] + b[i + W - 1] + 2 * b[i + W] + b[i + W + 1];
    const m = Math.sqrt(gx * gx + gy * gy);
    mag[i] = m; if (m > maxMag) maxMag = m;
    let a = Math.atan2(gy, gx) * (180 / Math.PI); if (a < 0) a += 180;
    dir[i] = (a < 22.5 || a >= 157.5) ? 0 : (a < 67.5) ? 1 : (a < 112.5) ? 2 : 3;
  }
  const nms = new Float32Array(n);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, m = mag[i];
    if (m === 0) continue;
    let n1, n2;
    switch (dir[i]) {
      case 0: n1 = mag[i - 1]; n2 = mag[i + 1]; break;
      case 1: n1 = mag[i + W + 1]; n2 = mag[i - W - 1]; break;
      case 2: n1 = mag[i - W]; n2 = mag[i + W]; break;
      default: n1 = mag[i + W - 1]; n2 = mag[i - W + 1];
    }
    if (m >= n1 && m >= n2) nms[i] = m;
  }
  const BINS = 1024, hist = new Int32Array(BINS);
  const scale = maxMag > 0 ? (BINS - 1) / maxMag : 0;
  for (let i = 0; i < n; i++) if (nms[i] > 0) hist[(nms[i] * scale) | 0]++;
  let acc = 0, bin = BINS - 1;
  for (; bin > 0; bin--) { acc += hist[bin]; if (acc >= edgeFrac * n) break; }
  const high = Math.max(bin / (scale || 1), 40), low = high * 0.45;
  const edge = new Uint8Array(n), stack = new Int32Array(n);
  let sp = 0;
  for (let i = 0; i < n; i++) if (nms[i] >= high) { edge[i] = 1; stack[sp++] = i; }
  while (sp > 0) {
    const i = stack[--sp], x = i % W, y = (i - x) / W;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue;
        const j = yy * W + xx; if (!edge[j] && nms[j] >= low) { edge[j] = 1; stack[sp++] = j; } } }
  }
  return edge;
}

// Remove edge pixels that sit on (or within 2px of) a shape border — those lines are drawn already.
function suppressNearBorders(edge, lab, W, H) {
  const n = W * H, near = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = i % W;
    if ((x < W - 1 && lab[i] !== lab[i + 1]) || (i < n - W && lab[i] !== lab[i + W])) near[i] = 1;
  }
  const r = 2;
  for (let i = 0; i < n; i++) {
    if (!edge[i]) continue;
    const x = i % W, y = (i - x) / W;
    let hit = false;
    for (let dy = -r; dy <= r && !hit; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; if (near[yy * W + xx]) { hit = true; break; } } }
    if (hit) edge[i] = 0;
  }
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

// ---------------------------------------------------------------------------
// Pipeline: image → SVG
// ---------------------------------------------------------------------------
function traceImage(img, detailLevel) {
  const cfg = DETAIL[detailLevel] || DETAIL[3];
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.min(1, cfg.side / Math.max(iw, ih));
  const W = Math.max(8, Math.round(iw * s)), H = Math.max(8, Math.round(ih * s));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  const n = W * H;

  const smooth = bilateral(data, W, H, 4, 2.6, cfg.sigmaR, 3);
  const lab = rgbToLab(smooth, n);
  let cls = kmeansLabels(lab, n, cfg.K, 10);
  cls = modeFilter(cls, W, H, cfg.K, 3);
  const comp = components(cls, W, H);
  const { lab: labels, count, areas } = mergeSmall(comp.lab, W, H, comp.count, comp.areas, {
    minArea: Math.max(40, cfg.minAreaFrac * n),
    islandArea: cfg.islandFrac * n,
    sliverArea: cfg.sliverFrac * n,
    sliverRatio: cfg.sliverRatio,
  });
  const loops = traceLabels(labels, W, H, count);

  // Interior detail lines from the smoothed photo's luminance.
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) gray[i] = 0.299 * smooth[i * 3] + 0.587 * smooth[i * 3 + 1] + 0.114 * smooth[i * 3 + 2];
  const edge = cannyEdges(gray, W, H, 1.2, cfg.edgeFrac);
  suppressNearBorders(edge, labels, W, H);
  const chains = edgeChains(edge, W, H, cfg.minChain).map((c) => chaikinOpen(simplifyOpen(c, 1.4)));

  const k = Math.max(0.7, Math.max(W, H) / 640);
  const lw = fmt(LINE_WIDTH * k), dw = fmt(DETAIL_WIDTH * k);
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  parts.push(`<g id="regions" fill-rule="evenodd" stroke="${INK}" stroke-width="${lw}" stroke-linejoin="round" stroke-linecap="round">`);
  for (let L = 0; L < count; L++) {
    const d = loopsToPath(loops[L]);
    if (!d) continue;
    parts.push(`<path data-id="${L}" data-area="${areas[L]}" d="${d}" fill="${BLANK}"/>`);
  }
  parts.push('</g>');
  parts.push(`<path id="lines" d="${chainsToPath(chains)}" fill="none" stroke="${INK}" stroke-width="${dw}" stroke-linejoin="round" stroke-linecap="round" pointer-events="none"/>`);
  parts.push('</svg>');
  return { svgText: parts.join(''), W, H, regionCount: count };
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
  playColor(color, +path.dataset.area / (state.W * state.H));
  if (navigator.vibrate) navigator.vibrate(8);
  color.button.classList.remove('ping'); void color.button.offsetWidth; color.button.classList.add('ping');
  updateButtons();
}
function undo() {
  const entry = state.undo.pop();
  if (!entry) return;
  for (const { el: p, prev } of entry) p.setAttribute('fill', prev);
  updateButtons();
}
function clearAll() {
  const entry = [];
  for (const { el: p } of state.regions) {
    const prev = p.getAttribute('fill');
    if (prev !== BLANK) { entry.push({ el: p, prev }); p.setAttribute('fill', BLANK); }
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
    const { svgText, W, H, regionCount } = traceImage(state.image, +el.detail.value);
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
