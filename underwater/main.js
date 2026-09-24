// =====================================================================
// Blue Hollow: a side-view dive through a cut-paper lagoon.
// Arrow keys swim; clicking swims you to a spot (or a clam).
// Everything is flat paper: no lighting, no shadows, no perspective.
// World units are roughly pixels; 25 units = 1 metre of depth.
// =====================================================================

const W = 6400, H = 1500, SURF = 170;   // world size and water line
const UNITS_PER_M = 25;
const PEARL_COUNT = 20;
const BOIL_FPS = 6;                     // stop-motion rate for ambient motion

// ---------- seeded random + noise ----------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260924);
const rr = (a, b) => a + (b - a) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const perm = new Uint8Array(512);
{
  const p = Array.from({ length: 256 }, (_, i) => i);
  const r = mulberry32(1337);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function grad(h, x, y) {
  const g = h & 7, u = g < 4 ? x : y, v = g < 4 ? y : x;
  return ((g & 1) ? -u : u) + ((g & 2) ? -2 * v : 2 * v);
}
function noise2(x, y) {
  const xf = Math.floor(x), yf = Math.floor(y);
  const X = xf & 255, Y = yf & 255;
  x -= xf; y -= yf;
  const u = fade(x), v = fade(y);
  const a = perm[X] + Y, b = perm[X + 1] + Y;
  return 0.35 * lerp(
    lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u),
    lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u), v);
}
function fbm(x, y, oct = 4) {
  let s = 0, a = 1, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// ---------- palette (from the cut-paper shapes in ../shapes-1) -------
const PAL = {
  pink: '#eaa8cb', orange: '#ef7426', green: '#0f7160', yellow: '#d9c227', lemon: '#f5e663',
  cream: '#faf4ef', ink: '#1d1d1b', blue: '#3d6fb6', rose: '#d9829f', sand: '#f6e7d3',
};
const WATER = ['#b3e0df', '#9ad3d4', '#80c3c7', '#63aeb4', '#4b979f', '#377f88'];

// ---------- the seabed profile ---------------------------------------
const GSTEP = 8;
const ground = new Float32Array(Math.ceil(W / GSTEP) + 2);
for (let i = 0; i < ground.length; i++) {
  const x = i * GSTEP;
  let g = 1060 + fbm(x * 0.0011, 3.7, 4) * 520;
  g += Math.exp(-(((x - 3700) / 420) ** 2)) * 300;        // the deep trench
  g += Math.exp(-(((x - 5400) / 300) ** 2)) * 140;
  g -= Math.exp(-(((x - 900) / 520) ** 2)) * 330;         // sunny shallows near the start
  g -= smooth(300, 0, x) * 760 + smooth(W - 300, W, x) * 760;  // lagoon walls
  g += noise2(x * 0.03, 11) * 10;                          // hand-cut edge
  ground[i] = clamp(g, SURF + 150, H - 60);
}
function groundAt(x) {
  const f = clamp(x, 0, W) / GSTEP, i = Math.floor(f);
  return lerp(ground[i], ground[Math.min(i + 1, ground.length - 1)], f - i);
}
const deepLine = (x) => 1235 + Math.sin(x * 0.004) * 30 + noise2(x * 0.02, 5) * 16;

// ---------- canvas ------------------------------------------------------
const canvas = document.createElement('canvas');
document.getElementById('game').appendChild(canvas);
const ctx = canvas.getContext('2d');
const view = { w: 0, h: 0, scale: 1, dpr: 1, x: 0, y: 0 };  // x,y = world coords of the top-left corner
function resize() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = window.innerWidth, ch = window.innerHeight;
  canvas.width = Math.round(cw * view.dpr); canvas.height = Math.round(ch * view.dpr);
  canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
  view.scale = Math.min(ch / 820, cw / 560);
  view.w = cw / view.scale; view.h = ch / view.scale;
}
resize();
window.addEventListener('resize', resize);

// ---------- art: your shapes + matching hand-cut ones ---------------------------
function loadImage(src) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
}
// Crops a transparent PNG to its visible shape (some source files are mostly empty canvas).
function trimmed(img) {
  if (!img) return null;
  try {
    const s = Math.min(1, 700 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.ceil(img.width * s); c.height = Math.ceil(img.height * s);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < x0) return null;
    const o = document.createElement('canvas');
    o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
    o.getContext('2d').drawImage(c, -x0, -y0);
    return o;
  } catch (e) { return null; }
}
// The shapes load from the repo's shapes-1/ and new/ folders; a single-file build can inline them as window.SHAPE_ART.
const ASSET_BASE = document.querySelector('meta[name="asset-base"]')?.content ?? '../';
const art = Object.fromEntries(await Promise.all([
  ['pinkflower', 'shapes-1/pinkflower.png'], ['redflower', 'shapes-1/redflower.png'],
  ['greenflower', 'shapes-1/greenflower.png'], ['redsun', 'shapes-1/redsun.png'],
  ['pinktriangle', 'shapes-1/pinktriangle.png'], ['semicircle', 'shapes-1/semicircle.png'],
  ['macaroni', 'shapes-1/yellowmacaroni.png'], ['noodle', 'new/yellow%20noodle.png'],
].map(async ([k, p]) => [k, trimmed(await loadImage(window.SHAPE_ART?.[k] ?? ASSET_BASE + p))])));

// drawing helpers (all draw in a w×h box, origin top-left)
let crand = mulberry32(77);
function blob(g, cx, cy, rx, ry, wob = 0.06) {
  const seed = crand() * 60;
  g.beginPath();
  for (let i = 0; i <= 56; i++) {
    const a = (i / 56) * Math.PI * 2;
    const r = 1 + wob * 2.4 * noise2(Math.cos(a) * 1.4 + seed, Math.sin(a) * 1.4 + seed);
    g.lineTo(cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r);
  }
  g.closePath();
}
function fillWith(g, path, color, pattern) {
  path(); g.fillStyle = color; g.fill();
  if (pattern) { g.save(); path(); g.clip(); pattern(); g.restore(); }
}
function stripes(g, w, h, color, width, gap, angle = 0.5) {
  g.save(); g.translate(w / 2, h / 2); g.rotate(angle);
  g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round';
  const R = Math.hypot(w, h);
  for (let x = -R; x < R; x += width + gap) {
    g.beginPath();
    for (let y = -R; y <= R; y += 8) g.lineTo(x + Math.sin(y * 0.03 + x) * width * 0.45, y);
    g.stroke();
  }
  g.restore();
}
function dashes(g, w, h, color, n, len = 16, thick = 6) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    g.save(); g.translate(crand() * w, crand() * h); g.rotate(-0.7 + crand() * 0.5);
    g.beginPath(); g.roundRect(-len / 2, -thick / 2, len * (0.6 + crand() * 0.7), thick, thick / 2); g.fill();
    g.restore();
  }
}
function spots(g, w, h, color, n, r = 6) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) { g.beginPath(); g.arc(crand() * w, crand() * h, r * (0.6 + crand() * 0.7), 0, 7); g.fill(); }
}
function noodle(g, pts, width, color) {
  g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); pts.forEach(([x, y]) => g.lineTo(x, y)); g.stroke();
}
function wavyLine(x0, y0, y1, amp, freq, phase) {
  const pts = [];
  for (let y = y0; y >= y1; y -= 5) pts.push([x0 + Math.sin(y * freq + phase) * amp, y]);
  return pts;
}
function drawArt(img, fallback) {
  return (g, w, h) => {
    if (!img) return fallback(g, w, h);
    const s = Math.min(w / img.width, h / img.height);
    g.drawImage(img, (w - img.width * s) / 2, h - img.height * s, img.width * s, img.height * s);
  };
}
function flower(petals, color, centre, pattern) {
  return (g, w, h) => {
    const cx = w / 2, cy = w / 2, R = w * 0.27;
    noodle(g, wavyLine(cx, h, cy, 4, 0.05, 1), w * 0.06, PAL.green);
    const path = () => {
      g.beginPath();
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2 + 0.3;
        g.moveTo(cx + Math.cos(a) * R + R * 0.62, cy + Math.sin(a) * R);
        g.ellipse(cx + Math.cos(a) * R, cy + Math.sin(a) * R, R * 0.62, R * 0.58, a, 0, Math.PI * 2);
      }
    };
    fillWith(g, path, color, pattern && (() => pattern(g, w, h)));
    blob(g, cx, cy, R * 0.42, R * 0.4, 0.1); g.fillStyle = centre; g.fill();
  };
}
// A flower (art or hand-cut) set on a stem, so it grows out of the seabed.
function onStem(img, fallback) {
  return (g, w, h) => {
    if (!img) return fallback(g, w, h);
    noodle(g, wavyLine(w / 2, h, w * 0.5, 4, 0.05, 2), w * 0.06, PAL.green);
    const s = Math.min(w / img.width, (w * 0.95) / img.height);
    g.drawImage(img, (w - img.width * s) / 2, w * 0.5 - (img.height * s) / 2, img.width * s, img.height * s);
  };
}
function fishArt(body, pattern, fin) {
  return (g, w, h) => {
    const by = h * 0.5;
    g.fillStyle = fin;
    g.beginPath(); g.moveTo(w * 0.34, by); g.lineTo(w * 0.04, by - h * 0.38);
    g.quadraticCurveTo(w * 0.14, by, w * 0.04, by + h * 0.38); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(w * 0.42, by - h * 0.22); g.quadraticCurveTo(w * 0.52, by - h * 0.58, w * 0.7, by - h * 0.26); g.closePath(); g.fill();
    fillWith(g, () => blob(g, w * 0.6, by, w * 0.32, h * 0.33, 0.035), body, pattern && (() => pattern(g, w, h)));
    g.beginPath(); g.arc(w * 0.8, by - h * 0.07, h * 0.1, 0, 7); g.fillStyle = PAL.cream; g.fill();
    g.beginPath(); g.arc(w * 0.815, by - h * 0.07, h * 0.05, 0, 7); g.fillStyle = PAL.ink; g.fill();
  };
}

// A sprite is a few slightly different cuts of the same shape; cycling them gives a stop-motion wobble.
const RES = 2;
function sprite(w, h, draw, variants = 3) {
  const cuts = [];
  for (let v = 0; v < variants; v++) {
    crand = mulberry32(1000 + v * 31 + Math.floor(w * 7 + h * 13));
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * RES); c.height = Math.ceil(h * RES);
    const g = c.getContext('2d');
    g.scale(RES, RES);
    // tiny per-cut jitter so the edges shimmer like re-cut paper
    g.translate(w / 2, h / 2); g.rotate((v - 1) * 0.012); g.scale(1 + (v - 1) * 0.008, 1 - (v - 1) * 0.008); g.translate(-w / 2, -h / 2);
    draw(g, w, h);
    cuts.push(c);
  }
  return { cuts, w, h };
}

const S = {};
S.fish = {
  blueDash: sprite(96, 48, fishArt(PAL.blue, (g, w, h) => dashes(g, w, h, PAL.lemon, 14, 8, 3), PAL.lemon)),
  blueStripe: sprite(96, 48, fishArt(PAL.blue, (g, w, h) => stripes(g, w, h, PAL.cream, 3.5, 10, 0.2), PAL.pink)),
  yellowDot: sprite(80, 40, fishArt(PAL.yellow, (g, w, h) => spots(g, w, h, PAL.orange, 12, 3), PAL.orange)),
  sardine: sprite(60, 26, fishArt(PAL.cream, (g, w, h) => { g.fillStyle = PAL.blue; g.fillRect(0, h * 0.44, w, h * 0.12); }, PAL.blue)),
  clown: sprite(70, 36, fishArt(PAL.orange, (g, w, h) => stripes(g, w, h, PAL.cream, 6, 16, 0), PAL.ink)),
  pinkDash: sprite(90, 46, fishArt(PAL.pink, (g, w, h) => dashes(g, w, h, PAL.orange, 16, 8, 3), PAL.orange)),
  greenStripe: sprite(100, 50, fishArt(PAL.green, (g, w, h) => stripes(g, w, h, PAL.pink, 3, 8, 0.7), PAL.pink)),
};
S.jelly = [PAL.pink, PAL.lemon, PAL.cream, PAL.rose].map((bell, i) => sprite(70, 120, (g, w, h) => {
  const tent = [PAL.orange, PAL.pink, PAL.orange, PAL.lemon][i];
  for (let k = 0; k < 5; k++) noodle(g, wavyLine(w * (0.22 + k * 0.14), h - 4, h * 0.3, 3, 0.12, k * 1.7 + crand()), 3, tent);
  fillWith(g, () => { g.beginPath(); g.ellipse(w / 2, h * 0.32, w * 0.46, h * 0.28, 0, Math.PI, 0); g.closePath(); }, bell,
    () => stripes(g, w, h, i % 2 ? PAL.pink : PAL.orange, 3.5, 7, 0));
}));
S.plants = {
  shallow: [
    sprite(110, 190, onStem(art.pinkflower, flower(5, PAL.pink, PAL.orange))),
    sprite(110, 170, onStem(art.redflower, flower(5, PAL.orange, PAL.pink))),
    sprite(120, 180, onStem(art.greenflower, flower(6, PAL.green, PAL.pink, (g, w, h) => stripes(g, w, h, PAL.pink, 2.5, 9, 0.4)))),
    sprite(100, 160, flower(6, PAL.yellow, PAL.orange)),
    sprite(120, 110, drawArt(art.pinktriangle, (g, w, h) => fillWith(g, () => { g.beginPath(); g.moveTo(w / 2, 4); g.lineTo(w - 4, h); g.lineTo(4, h); g.closePath(); }, PAL.pink, () => dashes(g, w, h, PAL.orange, 30)))),
    sprite(130, 70, drawArt(art.semicircle, (g, w, h) => fillWith(g, () => { g.beginPath(); g.arc(w / 2, h, w * 0.48, Math.PI, 0); g.closePath(); }, PAL.pink, () => stripes(g, w, h, PAL.orange, 5, 8, 0.6)))),
    sprite(130, 70, (g, w, h) => fillWith(g, () => { g.beginPath(); g.arc(w / 2, h, w * 0.48, Math.PI, 0); g.closePath(); }, PAL.orange, () => stripes(g, w, h, PAL.pink, 5, 8, -0.6))),
    sprite(60, 130, (g, w, h) => { noodle(g, wavyLine(w / 2, h, h * 0.35, 3, 0.06, 0), 5, PAL.green); blob(g, w / 2, h * 0.28, w * 0.4, w * 0.4, 0.05); g.fillStyle = PAL.orange; g.fill(); }),
  ],
  mid: [
    sprite(170, 80, drawArt(art.macaroni, (g, w, h) => { g.beginPath(); g.arc(w / 2, h, w * 0.4, Math.PI, 0); g.strokeStyle = PAL.yellow; g.lineWidth = 22; g.stroke(); })),
    sprite(110, 100, (g, w, h) => fillWith(g, () => { g.beginPath(); g.moveTo(w / 2, 4); g.lineTo(w - 6, h); g.lineTo(6, h); g.closePath(); }, PAL.green, () => stripes(g, w, h, PAL.lemon, 3, 10, -0.4))),
    sprite(100, 170, onStem(art.redsun, (g, w, h) => { noodle(g, wavyLine(w / 2, h, w / 2, 3, 0.06, 0), 6, PAL.green); blob(g, w / 2, w / 2, w * 0.42, w * 0.42, 0.05); g.fillStyle = PAL.orange; g.fill(); })),
  ],
  grass: [PAL.green, PAL.yellow, '#3c8a55'].map((c) => sprite(70, 70, (g, w, h) => {
    for (let k = 0; k < 4; k++) noodle(g, wavyLine(w * (0.18 + k * 0.21), h, h * (0.1 + crand() * 0.35), 3, 0.1, k + crand() * 3), 5, c);
  })),
};
S.rock = [
  sprite(200, 110, (g, w, h) => fillWith(g, () => blob(g, w / 2, h * 1.02, w * 0.48, h * 0.98, 0.05), PAL.green, () => stripes(g, w, h, PAL.pink, 4, 14, 0.5))),
  sprite(170, 90, (g, w, h) => fillWith(g, () => blob(g, w / 2, h * 1.02, w * 0.48, h * 0.98, 0.07), PAL.ink, () => spots(g, w, h, PAL.cream, 14, 4))),
  sprite(150, 90, (g, w, h) => fillWith(g, () => blob(g, w / 2, h * 1.02, w * 0.48, h * 0.98, 0.05), PAL.rose, () => dashes(g, w, h, PAL.green, 18, 12, 5))),
];
S.vent = sprite(90, 120, (g, w, h) => fillWith(g, () => { g.beginPath(); g.moveTo(w * 0.36, 4); g.lineTo(w * 0.64, 4); g.lineTo(w - 3, h); g.lineTo(3, h); g.closePath(); }, PAL.ink,
  () => { for (let k = 0; k < 4; k++) noodle(g, wavyLine(w * (0.28 + k * 0.15), h, 8, 2, 0.12, k), 2, PAL.cream); }));
const clamShell = (g, w, h) => fillWith(g, () => { g.beginPath(); g.moveTo(w / 2, h); g.arc(w / 2, h, w * 0.48, Math.PI, 0); g.closePath(); }, PAL.orange,
  () => { g.strokeStyle = PAL.pink; g.lineWidth = 3; for (let k = 1; k < 8; k++) { const a = Math.PI + (k / 8) * Math.PI; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2 + Math.cos(a) * w, h + Math.sin(a) * w); g.stroke(); } });
S.clamOpen = sprite(90, 70, (g, w, h) => {
  g.save(); g.translate(0, -h * 0.28); clamShell(g, w, h * 0.8); g.restore();     // lid, lifted
  g.fillStyle = PAL.pink; g.fillRect(w * 0.1, h * 0.52, w * 0.8, h * 0.06);
  g.save(); g.translate(0, h * 0.55); g.scale(1, 0.45); g.translate(w, h); g.rotate(Math.PI); clamShell(g, w, h); g.restore();
  g.beginPath(); g.arc(w / 2, h * 0.52, w * 0.13, 0, 7); g.fillStyle = PAL.cream; g.fill();
});
S.clamShut = sprite(90, 70, (g, w, h) => { g.save(); g.translate(0, h * 0.35); g.scale(1, 0.65); clamShell(g, w, h); g.restore(); });
S.star = sprite(56, 56, (g, w, h) => {
  const star = (r1, r2, rot, fill) => {
    g.beginPath();
    for (let i = 0; i < 8; i++) { const a = rot + (i * Math.PI) / 4, r = i % 2 ? r2 : r1; g.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r); }
    g.closePath(); g.fillStyle = fill; g.fill();
  };
  star(w * 0.3, w * 0.06, Math.PI / 4, PAL.orange);
  star(w * 0.48, w * 0.07, 0, PAL.lemon);
});
S.sun = sprite(150, 150, drawArt(art.redsun, (g, w, h) => { blob(g, w / 2, h / 2, w * 0.46, h * 0.46, 0.05); g.fillStyle = PAL.orange; g.fill(); }), 1);
S.cloud = [0, 1].map(() => sprite(220, 70, (g, w, h) => { blob(g, w / 2, h / 2, w * 0.47, h * 0.4, 0.12); g.fillStyle = PAL.pink; g.fill(); }, 2));

function drawSprite(sp, x, y, w, h, frame, flip = false, rot = 0, ox = 0.5, oy = 1) {
  // (x, y) is the anchor point in world units; ox/oy place the anchor inside the sprite
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(sp.cuts[frame % sp.cuts.length], -w * ox, -h * oy, w, h);
  ctx.restore();
}

// Paper grain: a static overlay of fibres and specks, multiplied over the scene.
const grain = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  const r = mulberry32(5);
  for (let i = 0; i < 2600; i++) { const v = 200 + Math.floor(r() * 50); g.fillStyle = `rgb(${v},${v},${v - 6})`; g.fillRect(r() * 256, r() * 256, 1 + r() * 1.5, 1 + r() * 1.5); }
  g.lineCap = 'round';
  for (let i = 0; i < 140; i++) {
    const v = 190 + Math.floor(r() * 50); g.strokeStyle = `rgb(${v},${v - 4},${v - 10})`; g.lineWidth = 0.6 + r() * 0.6;
    const x = r() * 256, y = r() * 256, a = r() * 6.28, l = 6 + r() * 20;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 1) * l * 0.5, y + Math.sin(a + 1) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  return ctx.createPattern(c, 'repeat');
})();

// =====================================================================
// World layout: everything stands side by side on the seabed, no overlaps
// =====================================================================
const scenery = [];   // { sp, x, y, w, h, sway, phase } or kelp noodles
const clams = [];
const vents = [];
{
  const taken = [];   // occupied [x0, x1] spans along the seabed
  const free = (x0, x1) => taken.every(([a, b]) => x1 < a || x0 > b);
  const place = (x, w) => { taken.push([x - w / 2, x + w / 2]); };
  const baseY = (x, w) => Math.max(groundAt(x - w * 0.35), groundAt(x + w * 0.35)) + 6;
  const flatEnough = (x, w) => Math.abs(groundAt(x - w / 2) - groundAt(x + w / 2)) < w * 0.35;

  // pearls first, spread across the lagoon from shallow to deep
  for (let i = 0; i < PEARL_COUNT; i++) {
    for (let t = 0; t < 400; t++) {
      // try this pearl's own stretch of the lagoon first, then anywhere
      const x = t < 60 ? 420 + ((i + rand()) / PEARL_COUNT) * (W - 840) : rr(420, W - 420);
      if (!free(x - 60, x + 60) || (t < 200 && !flatEnough(x, 90))) continue;
      place(x, 110);
      clams.push({ x, y: baseY(x, 90), taken: false, phase: rand() * 6.28 });
      break;
    }
  }
  // vents in the deep water
  for (let i = 0; i < 5; i++) {
    const x = rr(2600, 5800);
    if (groundAt(x) < 1200 || !free(x - 55, x + 55)) continue;
    place(x, 90);
    const y = baseY(x, 90);
    scenery.push({ sp: S.vent, x, y, w: 90, h: 120, sway: 0 });
    vents.push({ x, y: y - 116 });
  }
  // kelp forests: noodles stand close together, like a bundle of paper strips
  for (let f = 0; f < 9; f++) {
    const cx = rr(1400, W - 400);
    if (groundAt(cx) < 1050) continue;
    const n = 4 + Math.floor(rand() * 5);
    for (let k = 0; k < n; k++) {
      const x = cx + (k - n / 2) * rr(22, 34);
      if (!free(x - 10, x + 10)) continue;
      const h = Math.min(rr(360, 720), groundAt(x) - SURF - 120);
      scenery.push({ kelp: true, x, y: groundAt(x) + 8, h, width: rr(12, 18), color: pick([PAL.lemon, PAL.green, PAL.yellow, '#8fb34a']), phase: rand() * 6.28 });
    }
    place(cx, n * 30);
  }
  // rocks, flowers and shapes, keeping clear of each other
  for (let x = 200; x < W - 200;) {
    const g = groundAt(x);
    const pool = g < 950 ? S.plants.shallow : g < 1180 ? [...S.plants.shallow.slice(4), ...S.plants.mid] : S.plants.mid;
    const r = rand();
    let sp, w, h, sway = 0.02;
    if (r < 0.2) { sp = pick(S.rock); w = sp.w * rr(0.7, 1.3); h = sp.h * (w / sp.w); sway = 0; }
    else if (r < 0.42) { sp = pick(S.plants.grass); w = rr(50, 80); h = w; sway = 0.06; }
    else { sp = pick(pool); const k = rr(0.75, 1.15); w = sp.w * k; h = sp.h * k; }
    if (free(x - w / 2, x + w / 2)) {
      place(x, w);
      scenery.push({ sp, x, y: baseY(x, w), w, h, sway, phase: rand() * 6.28 });
    }
    x += w * 0.5 + rr(20, 140);
  }
}
// sand markings: dashes cut from pink (shallow) or orange (deep) paper
const sandDashes = [];
for (let i = 0; i < 1800; i++) {
  const x = rr(0, W), g = groundAt(x);
  const y = rr(g + 14, H + 10);
  sandDashes.push({ x, y, a: rr(-0.7, -0.2), l: rr(10, 20), deep: y > deepLine(x) });
}
sandDashes.sort((a, b) => a.x - b.x);

// ---------- fish -------------------------------------------------------------
const SPECIES = [
  { sp: ['blueDash', 'blueStripe'], n: 16, len: [70, 90], speed: [70, 140] },
  { sp: ['yellowDot'], n: 18, len: [50, 64], speed: [60, 120] },
  { sp: ['sardine'], n: 34, len: [34, 42], speed: [90, 170] },
  { sp: ['clown'], n: 10, len: [44, 52], speed: [50, 100] },
  { sp: ['pinkDash', 'greenStripe'], n: 14, len: [60, 84], speed: [60, 130] },
];
const schools = [];
const fishes = [];
for (const spec of SPECIES) {
  for (let s = 0; s < 2; s++) {
    const school = { spec, members: [], seed: rand() * 100, tx: 0, ty: 0 };
    schools.push(school);
    const cx = rr(500, W - 500);
    for (let k = 0; k < spec.n / 2; k++) {
      const x = cx + rr(-150, 150);
      const f = {
        x, y: rr(SURF + 120, groundAt(x) - 80), vx: rr(-1, 1) * spec.speed[0], vy: 0,
        len: rr(spec.len[0], spec.len[1]), sp: S.fish[spec.sp[k % spec.sp.length]], face: 1, phase: rand() * 6.28,
      };
      school.members.push(f);
      fishes.push(f);
    }
  }
}
function updateFish(dt, t, diver) {
  for (const sc of schools) {
    // each school wanders along the lagoon
    const a = t * 0.02 + sc.seed;
    sc.tx = W / 2 + Math.sin(a) * (W / 2 - 500) * Math.cos(a * 0.37 + sc.seed);
    sc.ty = lerp(SURF + 150, groundAt(sc.tx) - 110, 0.35 + 0.35 * Math.sin(a * 1.7 + sc.seed));
    const m = sc.members, speed = sc.spec.speed;
    for (const f of m) {
      let ax = 0, ay = 0, cx = 0, cy = 0, vx = 0, vy = 0, n = 0;
      for (const o of m) {
        if (o === f) continue;
        const dx = f.x - o.x, dy = f.y - o.y, d2 = dx * dx + dy * dy;
        if (d2 < 160 * 160) {
          cx += o.x; cy += o.y; vx += o.vx; vy += o.vy; n++;
          if (d2 < 45 * 45) { const k = 1 / Math.max(d2, 20); ax += dx * k * 900; ay += dy * k * 900; }
        }
      }
      if (n) { ax += (cx / n - f.x) * 0.6 + (vx / n - f.vx) * 0.9; ay += (cy / n - f.y) * 0.6 + (vy / n - f.vy) * 0.9; }
      ax += (sc.tx - f.x) * 0.08; ay += (sc.ty - f.y) * 0.12;
      const dx = f.x - diver.x, dy = f.y - diver.y, dd = Math.hypot(dx, dy);
      const fleeing = dd < 190;
      if (fleeing && dd > 1) { ax += dx / dd * 900 * (1 - dd / 190); ay += dy / dd * 900 * (1 - dd / 190); }
      const floor = groundAt(f.x) - 50;
      if (f.y > floor) ay -= (f.y - floor) * 8;
      if (f.y < SURF + 60) ay += (SURF + 60 - f.y) * 8;
      ay -= f.vy * 1.2;                       // fish mostly swim level
      f.vx += ax * dt; f.vy += ay * dt;
      const sp = Math.hypot(f.vx, f.vy), hi = speed[1] * (fleeing ? 1.8 : 1), lo = speed[0];
      if (sp > hi) { f.vx *= hi / sp; f.vy *= hi / sp; } else if (sp < lo) { f.vx *= lo / Math.max(sp, 1); f.vy *= lo / Math.max(sp, 1); }
      f.x = clamp(f.x + f.vx * dt, 40, W - 40); f.y += f.vy * dt;
      if (Math.abs(f.vx) > 12) f.face = Math.sign(f.vx);
    }
  }
}

// ---------- jellyfish ---------------------------------------------------------------
const jellies = [];
while (jellies.length < 14) {
  const x = rr(1800, W - 300), g = groundAt(x);
  if (g < 1000) continue;
  const s = rr(0.8, 1.4);
  jellies.push({ hx: x, hy: rr(SURF + 220, g - 180), x, y: 0, s, sp: S.jelly[jellies.length % S.jelly.length], seed: rand() * 100 });
}
function updateJellies(t) {
  for (const j of jellies) {
    j.x = j.hx + Math.sin(t * 0.07 + j.seed) * 70;
    j.y = j.hy + Math.sin(t * 0.25 + j.seed) * 60;
  }
}

// ---------- bubbles ---------------------------------------------------------------
const bubbles = [];
function spawnBubble(x, y, r = rr(2.5, 6)) {
  if (bubbles.length > 400) bubbles.shift();
  bubbles.push({ x, y, r, vy: rr(50, 90) + r * 6, phase: rand() * 6.28 });
}
function updateBubbles(dt, t) {
  for (const b of bubbles) { b.y -= b.vy * dt; b.x += Math.sin(t * 3 + b.phase) * 16 * dt; }
  for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].y < SURF + 4) bubbles.splice(i, 1);
}

// =====================================================================
// Player, input, game state
// =====================================================================
const diver = { x: 700, y: SURF + 60, vx: 0, vy: 0, face: 1, target: null };
const game = { state: 'menu', o2: 100, score: 0, time: 0, stingCooldown: 0, breathTimer: 2 };
const keys = new Set();

const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hudRoot'), depth: $('hDepth'), ata: $('hAta'), temp: $('hTemp'), pearls: $('hPearls'),
  o2: $('o2'), o2Fill: $('o2Fill'), o2Val: $('o2Val'), toast: $('toast'), flash: $('flash'),
  arrow: $('sonarArrow'), sonarDist: $('sonarDist'),
  start: $('startScreen'), end: $('endScreen'),
  endTitle: $('endTitle'), endText: $('endText'), endEyebrow: $('endEyebrow'),
};

let toastTimer = 0;
function toast(msg, secs = 2.2) { ui.toast.textContent = msg; ui.toast.classList.add('on'); toastTimer = secs; }

function resetGame() {
  Object.assign(diver, { x: 700, y: SURF + 60, vx: 0, vy: 0, face: 1, target: null });
  Object.assign(game, { o2: 100, score: 0, time: 0, stingCooldown: 0, breathTimer: 2 });
  for (const c of clams) c.taken = false;
}
function startGame() {
  resetGame();
  game.state = 'play';
  ui.start.hidden = true; ui.end.hidden = true; ui.hud.hidden = false;
  toast('Find the sparkling clams');
}
function endGame(won) {
  game.state = 'over';
  ui.hud.hidden = true;
  ui.end.hidden = false;
  const mins = Math.floor(game.time / 60), secs = Math.floor(game.time % 60).toString().padStart(2, '0');
  if (won) {
    let best = null;
    try {
      best = Number(localStorage.getItem('blueHollowBest')) || null;
      if (!best || game.time < best) localStorage.setItem('blueHollowBest', String(game.time));
    } catch (e) { /* storage unavailable */ }
    const record = !best || game.time < best;
    ui.endEyebrow.textContent = record ? 'New best time' : 'Dive log';
    ui.endTitle.textContent = 'Every pearl found';
    ui.endText.textContent = `You cleared Blue Hollow in ${mins}:${secs}` +
      (best && !record ? `. Your best is ${Math.floor(best / 60)}:${Math.floor(best % 60).toString().padStart(2, '0')}.` : '.');
  } else {
    ui.endEyebrow.textContent = 'Dive log';
    ui.endTitle.textContent = 'Out of air';
    ui.endText.textContent = `You surfaced with ${game.score} of ${clams.length} pearls after ${mins}:${secs} underwater. Come up to breathe sooner next time.`;
  }
}
$('startBtn').addEventListener('click', startGame);
$('restartBtn').addEventListener('click', startGame);

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
window.addEventListener('keydown', (e) => {
  if (!ARROWS.includes(e.code)) return;
  e.preventDefault();
  keys.add(e.code);
  diver.target = null;     // taking the keys cancels a click-to-swim
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// click (or tap) anywhere in the water to swim there; click a clam to swim to it
canvas.addEventListener('pointerdown', (e) => {
  if (game.state !== 'play') return;
  const wx = view.x + e.clientX / view.scale, wy = view.y + e.clientY / view.scale;
  const clam = clams.find((c) => !c.taken && Math.hypot(c.x - wx, c.y - 30 - wy) < 70);
  if (clam) diver.target = { x: clam.x, y: clam.y - 60 };
  else diver.target = { x: wx, y: clamp(wy, SURF + 20, groundAt(wx) - 40) };
});

// ---------- player update -------------------------------------------------
function updateDiver(dt) {
  let ix = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
  let iy = (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0);
  if (diver.target) {
    const dx = diver.target.x - diver.x, dy = diver.target.y - diver.y, d = Math.hypot(dx, dy);
    if (d < 24) diver.target = null;
    else { ix = dx / d; iy = dy / d; }
  }
  const l = Math.hypot(ix, iy);
  if (l > 1) { ix /= l; iy /= l; }
  diver.vx += ix * 900 * dt; diver.vy += iy * 900 * dt;
  const drag = Math.exp(-2.6 * dt);
  diver.vx *= drag; diver.vy *= drag;
  diver.vy += 12 * dt;                             // a little negative buoyancy
  diver.x = clamp(diver.x + diver.vx * dt, 120, W - 120);
  diver.y += diver.vy * dt;
  const floor = groundAt(diver.x) - 34;
  if (diver.y > floor) { diver.y = floor; diver.vy = Math.min(diver.vy, 0); }
  if (diver.y < SURF + 16) { diver.y = SURF + 16; diver.vy = Math.max(diver.vy, 0); }
  if (Math.abs(diver.vx) > 20) diver.face = Math.sign(diver.vx);

  // air
  const depth = (diver.y - SURF) / UNITS_PER_M;
  if (diver.y < SURF + 36) {
    if (game.o2 < 99) toast('Breathing', 0.6);
    game.o2 = Math.min(100, game.o2 + 30 * dt);
  } else {
    game.o2 -= (0.9 + depth * 0.03) * dt;
    game.breathTimer -= dt;
    if (game.breathTimer <= 0) {
      game.breathTimer = rr(3, 4.2);
      for (let i = 0; i < 8; i++) spawnBubble(diver.x + diver.face * 44 + rr(-6, 6), diver.y - 14 + rr(-6, 6));
    }
  }
  if (game.o2 <= 0) { game.o2 = 0; endGame(false); }
}

function updateInteractions(dt) {
  game.stingCooldown -= dt;
  for (const j of jellies) {
    if (Math.hypot(j.x - diver.x, j.y + 20 * j.s - diver.y) < 50 * j.s + 30 && game.stingCooldown <= 0) {
      game.stingCooldown = 1.5;
      game.o2 = Math.max(0, game.o2 - 12);
      const dx = diver.x - j.x, dy = diver.y - j.y, d = Math.hypot(dx, dy) || 1;
      diver.vx += dx / d * 260; diver.vy += dy / d * 260;
      diver.target = null;
      ui.flash.classList.add('on');
      requestAnimationFrame(() => requestAnimationFrame(() => ui.flash.classList.remove('on')));
      toast('Stung! −12 O₂');
    }
  }
  let nearest = null, nd = Infinity;
  for (const c of clams) {
    if (c.taken) continue;
    const d = Math.hypot(c.x - diver.x, c.y - 40 - diver.y);
    if (d < 75) {
      c.taken = true;
      game.score++;
      game.o2 = Math.min(100, game.o2 + 10);
      for (let i = 0; i < 16; i++) spawnBubble(c.x + rr(-20, 20), c.y - 30 + rr(-10, 10), rr(2, 5));
      toast(game.score === clams.length ? 'Last pearl!' : `Pearl ${game.score} of ${clams.length} · +10 O₂`);
      if (game.score === clams.length) setTimeout(() => endGame(true), 900);
    } else if (d < nd) { nd = d; nearest = c; }
  }
  if (nearest) {
    const ang = Math.atan2(nearest.x - diver.x, -(nearest.y - 40 - diver.y)) * 180 / Math.PI;
    ui.arrow.setAttribute('transform', `rotate(${ang.toFixed(1)})`);
    ui.sonarDist.textContent = `${Math.round(nd / UNITS_PER_M)} m`;
  } else ui.sonarDist.textContent = '--';
}

// ---------- HUD ---------------------------------------------------------------
let hudTimer = 0;
function updateHUD(dt) {
  hudTimer -= dt;
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) ui.toast.classList.remove('on'); }
  if (hudTimer > 0) return;
  hudTimer = 0.1;
  const depth = Math.max(0, (diver.y - SURF) / UNITS_PER_M);
  ui.depth.innerHTML = `${depth.toFixed(1)}<small>m</small>`;
  ui.ata.innerHTML = `${(1 + depth / 10).toFixed(1)}<small>ata</small>`;
  ui.temp.innerHTML = `${Math.round(27 - depth * 0.17)}<small>°C</small>`;
  ui.pearls.innerHTML = `${game.score}<small>/ ${clams.length}</small>`;
  ui.o2Fill.style.transform = `scaleX(${(game.o2 / 100).toFixed(3)})`;
  ui.o2Val.textContent = `${Math.ceil(game.o2)}%`;
  ui.o2.classList.toggle('low', game.o2 < 25);
}

// =====================================================================
// Drawing
// =====================================================================
function drawDiver(frame, moving) {
  const k = moving ? (frame % 2 ? 1 : -1) : 0;          // flipper kick, in stop-motion
  const tilt = clamp(diver.vy / 500, -0.35, 0.35) * diver.face;
  ctx.save();
  ctx.translate(diver.x, diver.y);
  ctx.scale(diver.face, 1);
  ctx.rotate(tilt * diver.face);
  // legs and flippers
  for (const [oy, swing] of [[2, 0.12 + k * 0.16], [6, -0.05 - k * 0.16]]) {
    ctx.save(); ctx.translate(-34, oy); ctx.rotate(swing);
    ctx.fillStyle = PAL.blue; ctx.fillRect(-40, -6, 42, 12);
    ctx.fillStyle = PAL.orange;
    ctx.beginPath(); ctx.moveTo(-38, -4); ctx.lineTo(-66, -16); ctx.lineTo(-62, 10); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // tank
  ctx.fillStyle = PAL.green;
  ctx.beginPath(); ctx.roundRect(-30, -26, 50, 16, 8); ctx.fill();
  // body
  ctx.fillStyle = PAL.lemon;
  ctx.beginPath(); ctx.ellipse(-4, 0, 38, 16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.pink; ctx.fillRect(-20, -14, 8, 29);
  // arm reaching forward
  ctx.save(); ctx.translate(18, 6); ctx.rotate(0.35 - k * 0.1); ctx.fillStyle = PAL.lemon; ctx.fillRect(0, -5, 30, 10);
  ctx.fillStyle = PAL.cream; ctx.beginPath(); ctx.arc(32, 0, 6, 0, 7); ctx.fill(); ctx.restore();
  // head, hood and mask
  ctx.fillStyle = PAL.cream; ctx.beginPath(); ctx.arc(40, -6, 15, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAL.ink; ctx.beginPath(); ctx.arc(38, -8, 15, Math.PI * 0.95, Math.PI * 1.9); ctx.closePath(); ctx.fill();
  ctx.fillStyle = PAL.orange; ctx.beginPath(); ctx.roundRect(40, -14, 16, 12, 5); ctx.fill();
  ctx.fillStyle = '#bfe6e4'; ctx.beginPath(); ctx.roundRect(43, -11, 10, 6, 3); ctx.fill();
  ctx.restore();
}

function waterEdge(x, st) {
  return SURF + Math.sin(x * 0.012 + st * 1.4) * 5 + Math.sin(x * 0.031 - st * 2.1) * 3;
}

function render(t, frame, st) {
  const dpr = view.dpr, sc = view.scale;
  ctx.setTransform(dpr * sc, 0, 0, dpr * sc, -view.x * dpr * sc, -view.y * dpr * sc);
  const x0 = view.x - 20, x1 = view.x + view.w + 20;

  // sky, sun and paper clouds
  ctx.fillStyle = PAL.cream;
  ctx.fillRect(x0, view.y - 10, x1 - x0, SURF + 30 - view.y);
  if (view.y < SURF) {
    drawSprite(S.sun, view.x + view.w * 0.78 - view.x * 0.04, 150, 110, 110, 0, false, 0, 0.5, 1);
    const cw = 2400;
    for (let i = 0; i < 3; i++) {
      const cx = ((i * 900 + 200 - view.x * 0.08) % cw + cw) % cw + view.x - 300;
      drawSprite(S.cloud[i % 2], cx, 60 + i * 22, 180, 55, frame, false, 0, 0.5, 0.5);
    }
  }

  // water, in bands of darker paper as it gets deeper
  const bandY = (k, x) => SURF + (k / WATER.length) * (H - SURF) * 0.92 + Math.sin(x * 0.004 + k * 1.7) * 18 + noise2(x * 0.01, k * 3) * 10;
  for (let k = 0; k < WATER.length; k++) {
    ctx.fillStyle = WATER[k];
    ctx.beginPath();
    for (let x = x0; x <= x1; x += 16) ctx.lineTo(x, k === 0 ? waterEdge(x, st) : bandY(k, x));
    ctx.lineTo(x1, H + 20); ctx.lineTo(x0, H + 20); ctx.closePath(); ctx.fill();
  }

  // kelp noodles and seabed shapes, tucked behind the seabed edge
  for (const s of scenery) {
    if (s.kelp) {
      if (s.x < x0 - 80 || s.x > x1 + 80) continue;
      const pts = [];
      for (let y = 0; y <= s.h; y += 12) {
        const u = y / s.h;
        pts.push([s.x + Math.sin(y * 0.018 + s.phase) * 12 + Math.sin(st * 1.1 + s.phase + u * 2.5) * 22 * u * u, s.y - y]);
      }
      noodle(ctx, pts, s.width, s.color);
      continue;
    }
    if (s.x + s.w < x0 || s.x - s.w > x1) continue;
    const rot = s.sway ? Math.sin(st * 1.3 + s.phase) * s.sway : 0;
    drawSprite(s.sp, s.x, s.y, s.w, s.h, frame, false, rot);
  }
  for (const c of clams) {
    if (c.x < x0 - 60 || c.x > x1 + 60) continue;
    drawSprite(c.taken ? S.clamShut : S.clamOpen, c.x, c.y, 90, 70, frame);
  }

  // the seabed: cream sand, pink in the deep, with cut-paper dashes
  const seabed = () => {
    ctx.beginPath();
    ctx.moveTo(x0, H + 20);
    for (let x = x0; x <= x1; x += GSTEP) ctx.lineTo(x, groundAt(x));
    ctx.lineTo(x1, H + 20); ctx.closePath();
  };
  seabed(); ctx.fillStyle = PAL.sand; ctx.fill();
  ctx.save(); seabed(); ctx.clip();
  ctx.fillStyle = PAL.pink;
  ctx.beginPath();
  for (let x = x0; x <= x1; x += 16) ctx.lineTo(x, deepLine(x));
  ctx.lineTo(x1, H + 20); ctx.lineTo(x0, H + 20); ctx.closePath(); ctx.fill();
  let lo = 0, hi = sandDashes.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sandDashes[m].x < x0) lo = m + 1; else hi = m; }
  for (let i = lo; i < sandDashes.length && sandDashes[i].x < x1; i++) {
    const d = sandDashes[i];
    ctx.fillStyle = d.deep ? PAL.orange : PAL.pink;
    ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.a);
    ctx.beginPath(); ctx.roundRect(-d.l / 2, -3, d.l, 6, 3); ctx.fill(); ctx.restore();
  }
  ctx.restore();

  // pearl sparkles
  for (const c of clams) {
    if (c.taken || c.x < x0 - 60 || c.x > x1 + 60) continue;
    const s = 44 + (frame % 3) * 6;
    drawSprite(S.star, c.x, c.y - 92, s, s, frame, false, Math.floor(t * 2) * 0.4 + c.phase, 0.5, 0.5);
  }

  // creatures
  for (const j of jellies) {
    if (j.x < x0 - 100 || j.x > x1 + 100) continue;
    const pulse = frame % 2 ? 0.94 : 1.04;
    drawSprite(j.sp, j.x, j.y, 70 * j.s * pulse, 120 * j.s / pulse, frame, false, 0, 0.5, 0.3);
  }
  for (const f of fishes) {
    if (f.x < x0 - 60 || f.x > x1 + 60) continue;
    const tilt = clamp(f.vy / 300, -0.4, 0.4) * f.face;
    drawSprite(f.sp, f.x, f.y, f.len, f.len * f.sp.h / f.sp.w, frame + (f.phase > 3 ? 1 : 0), f.face < 0, tilt, 0.5, 0.5);
  }
  if (game.state === 'play') drawDiver(frame, Math.hypot(diver.vx, diver.vy) > 40);
  ctx.fillStyle = PAL.cream;
  for (const b of bubbles) {
    if (b.x < x0 || b.x > x1) continue;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
  }
  if (diver.target && game.state === 'play') {
    ctx.fillStyle = PAL.cream;
    ctx.beginPath(); ctx.arc(diver.target.x, diver.target.y, 6, 0, 7); ctx.fill();
  }

  // paper grain over everything, fixed to the screen like the page itself
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = grain;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ---------- camera ---------------------------------------------------------
function updateCamera(dt, tx, ty) {
  const cx = clamp(tx - view.w / 2, 0, Math.max(0, W - view.w));
  const cy = clamp(ty - view.h * 0.45, -40, Math.max(-40, H - view.h));
  const k = Math.min(1, dt * 3);
  view.x = lerp(view.x, cx, k);
  view.y = lerp(view.y, cy, k);
}

// ---------- main loop ---------------------------------------------------------
let last = performance.now(), t = 0, ventTimer = 0, menuX = 700;
resetGame();
view.x = clamp(diver.x - view.w / 2, 0, W - view.w);
view.y = clamp(diver.y - view.h * 0.45, -40, H - view.h);

function frameLoop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (!document.hidden) t += dt;
  const frame = Math.floor(t * BOIL_FPS);
  const st = frame / BOIL_FPS;                         // stop-motion time for ambient motion

  if (game.state === 'play') {
    game.time += dt;
    updateDiver(dt);
    updateInteractions(dt);
    updateHUD(dt);
    updateCamera(dt, diver.x, diver.y);
  } else {
    // drift slowly along the lagoon behind the menu
    menuX += dt * 40;
    if (menuX > W - 700) menuX = 700;
    updateCamera(dt, menuX, SURF + 330);
  }
  updateFish(dt, t, game.state === 'play' ? diver : { x: -9999, y: -9999 });
  updateJellies(st);
  ventTimer -= dt;
  if (ventTimer <= 0) {
    ventTimer = 0.18;
    for (const v of vents) spawnBubble(v.x + rr(-8, 8), v.y, rr(3, 7));
  }
  updateBubbles(dt, t);
  render(t, frame, st);
  requestAnimationFrame(frameLoop);
}
requestAnimationFrame(frameLoop);

// exposed for tinkering from the console
window.blueHollow = { diver, game, clams, jellies, fishes, groundAt };
