// =====================================================================
// Deep House: a flooded house with doors to other places.
// Not a game: nothing to win or lose. Every place has its own creature
// with its own way of moving, and portals that lead on to other places.
//
//   house   a diver              swims
//   night   a lantern-bearer     drifts; nearby stars join up to you
//   dune    a parasol walker     walks and jumps
//   stand   a briefcase on legs  hops one step at a time
//   clock   a little alarm clock circles a clock face; time runs slow at the centre
//   shapes  a polygon            tumbles corner over corner; ↑ ↓ change its corners
//   orbit   a small moon         falls around planets under gravity
//   mirror  a spark              steers like a comet; its trail is mirrored twelve ways
//
// Rendering is deliberately lo-fi: the scene is drawn at a reduced resolution,
// printed twice slightly out of register, then covered in flickering grain.
// =====================================================================

const STEP_FPS = 6;        // ambient motion moves in small flip-book steps
const LOFI = 0.7;          // scene resolution relative to the screen

// ---------- small helpers ------------------------------------------------
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
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (k, dt) => 1 - Math.exp(-k * dt);

// ---------- canvases: a small scene buffer, printed onto the screen ------------
const out = document.createElement('canvas');
document.getElementById('game').appendChild(out);
const octx = out.getContext('2d');
const buf = document.createElement('canvas');
const ctx = buf.getContext('2d');
const view = { w: 0, h: 0, scale: 1, dpr: 1, x: 0, y: 0, k: 1, s: 1 };  // x,y = world coords of the top-left corner
function resize() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = window.innerWidth, ch = window.innerHeight;
  out.width = Math.round(cw * view.dpr); out.height = Math.round(ch * view.dpr);
  out.style.width = cw + 'px'; out.style.height = ch + 'px';
  buf.width = Math.round(out.width * LOFI); buf.height = Math.round(out.height * LOFI);
  const vh = world ? world.viewH : 760;
  view.scale = Math.min(ch / vh, cw / (vh * 0.68));
  view.w = cw / view.scale; view.h = ch / view.scale;
  view.k = view.scale * view.dpr * LOFI;
  view.s = vh / 760;                  // how big labels and lines should be in this world
}
window.addEventListener('resize', resize);

// ---------- textures ------------------------------------------------------------
function tile(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  return c;
}
function stipple(base, colors, count, size = 96, rMin = 0.5, rMax = 1.2, seed = 3) {
  return ctx.createPattern(tile(size, (g) => {
    if (base) { g.fillStyle = base; g.fillRect(0, 0, size, size); }
    const r = mulberry32(seed);
    for (let i = 0; i < count; i++) {
      g.fillStyle = colors[Math.floor(r() * colors.length)];
      g.beginPath(); g.arc(r() * size, r() * size, rMin + r() * (rMax - rMin), 0, 7); g.fill();
    }
  }), 'repeat');
}
const GRAIN = [11, 12, 13].map((seed) => octx.createPattern(tile(200, (g, s) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
  const r = mulberry32(seed);
  for (let i = 0; i < 5200; i++) { const v = 150 + Math.floor(r() * 100); g.fillStyle = `rgb(${v},${v - 2},${v - 8})`; g.fillRect(r() * s, r() * s, 1 + r(), 1 + r()); }
}), 'repeat'));
const FIBRE = octx.createPattern(tile(256, (g, s) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
  const r = mulberry32(9);
  g.lineCap = 'round';
  for (let i = 0; i < 520; i++) {
    const v = 205 + Math.floor(r() * 45); g.strokeStyle = `rgb(${v},${v - 3},${v - 9})`; g.lineWidth = 0.6 + r() * 0.6;
    const x = r() * s, y = r() * s, l = 4 + r() * 14, a = r() < 0.6 ? -1.05 : r() * 6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
}), 'repeat');
const TEX = {
  lawn: stipple('#4a9660', ['#3d8653', '#5aa56d', '#77b986', '#2f7a47'], 1800, 96, 0.5, 1.2, 4),
  cloud: stipple(null, ['#a8a8a8', '#d0d0d0', '#f0f0f0', '#ffffff'], 1800, 96, 0.4, 1.0, 5),
  plant: stipple('#2f8f4e', ['#256f3e', '#43a062', '#6cbf80'], 900, 64, 0.5, 1.1, 7),
};

// ---------- drawing helpers ---------------------------------------------------------
const INK = '#1e1e1e', PAPER = '#f4efe3';
function ink(w = 1.5, color = INK) { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
function box(x, y, w, h, fill, lw = 1.5) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); ink(lw); ctx.strokeRect(x, y, w, h); }
function circle(x, y, r, fill, stroke = true, lw = 1.5) { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); if (stroke) { ink(lw); ctx.stroke(); } }
function poly(pts, fill) { ctx.fillStyle = fill; ctx.beginPath(); for (const [x, y] of pts) ctx.lineTo(x, y); ctx.closePath(); ctx.fill(); }
function ngon(x, y, r, n, rot) { const pts = []; for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); } return pts; }
function splat(x, y, r, color, rot) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, rad = i % 2 ? r * 0.28 : r * (i % 4 ? 0.75 : 1); ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); }
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, 7); ctx.fill();
  ctx.restore();
}
const par = (lx, f) => lx + view.x * (1 - f);
const visible = (x, pad = 200) => x > view.x - pad && x < view.x + view.w + pad;
function aimAt(p, reach = 16) {
  const t = p.target; if (!t) return null;
  const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy);
  if (d < reach || (p.stuck || 0) > 0.6) { p.target = null; p.stuck = 0; return null; }
  return { ix: dx / d, iy: dy / d };
}

// ---------- portals ----------------------------------------------------------------
// A portal is an opening showing a flickering slice of the place it leads to, with a tag naming it.
// Shapes: circle (x, y, r), rect (x, y, w, h), tri (x, y, w, h; apex up), ngon (x, y, r, n; turning).
function portalPath(p, frame) {
  ctx.beginPath();
  if (p.shape === 'circle') ctx.arc(p.x, p.y, p.r, 0, 7);
  else if (p.shape === 'rect') ctx.rect(p.x, p.y, p.w, p.h);
  else if (p.shape === 'tri') { ctx.moveTo(p.x + p.w / 2, p.y); ctx.lineTo(p.x + p.w, p.y + p.h); ctx.lineTo(p.x, p.y + p.h); ctx.closePath(); }
  else if (p.shape === 'ngon') { for (const [x, y] of ngon(p.x, p.y, p.r, p.n, (p.spin || 0) + frame * 0.08)) ctx.lineTo(x, y); ctx.closePath(); }
}
function portalBox(p) {
  if (p.shape === 'circle' || p.shape === 'ngon') return { x: p.x - p.r, y: p.y - p.r, w: p.r * 2, h: p.r * 2 };
  return { x: p.x, y: p.y, w: p.w, h: p.h };
}
function drawPortal(p, frame, opts = {}) {
  const dest = WORLDS[p.to];
  const [a, b, c] = dest.swatch;
  const bx = portalBox(p);
  ctx.save();
  portalPath(p, frame); ctx.clip();
  ctx.fillStyle = a; ctx.fillRect(bx.x, bx.y, bx.w, bx.h);
  const shift = (frame % 4) * (bx.h / 8);
  ctx.fillStyle = b;
  for (let y = bx.y - bx.h + shift; y < bx.y + bx.h; y += bx.h / 4) ctx.fillRect(bx.x, y, bx.w, bx.h / 8);
  ctx.fillStyle = c;
  for (let i = 0; i < 6; i++) { const r2 = mulberry32(i * 7 + (frame % 3)); ctx.beginPath(); ctx.arc(bx.x + r2() * bx.w, bx.y + r2() * bx.h, (3 + r2() * 4) * view.s, 0, 7); ctx.fill(); }
  ctx.restore();
  ctx.setLineDash([6 * view.s, 5 * view.s]); ctx.lineDashOffset = -(frame % 4) * 3 * view.s;
  ink(2 * view.s, opts.lineColor || '#ffffff');
  portalPath(p, frame); ctx.stroke();
  ctx.setLineDash([]);
  if (!opts.noLabel) {
    const lx = bx.x + bx.w / 2, ly = opts.labelAbove ? bx.y - 34 * view.s : bx.y + bx.h + 12 * view.s;
    portalTag(dest.name, lx, ly);
  }
}
function portalTag(text, x, y) {
  const s = view.s;
  ctx.font = `500 ${13 * s}px Jost, Futura, "Century Gothic", sans-serif`;
  const w = ctx.measureText(text).width + 34 * s;
  box(x - w / 2, y, w, 22 * s, PAPER, 1.2 * s);
  poly([[x - w / 2 + 8 * s, y + 6 * s], [x - w / 2 + 16 * s, y + 11 * s], [x - w / 2 + 8 * s, y + 16 * s]], '#e2552d');
  ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x - w / 2 + 22 * s, y + 11.5 * s);
}
function inPortal(p, c) {
  if (p.shape === 'circle' || p.shape === 'ngon') return Math.hypot(c.x - p.x, c.y - p.y) < p.r;
  if (c.x < p.x || c.x > p.x + p.w || c.y < p.y || c.y > p.y + p.h) return false;
  if (p.shape === 'tri') return Math.abs(c.x - (p.x + p.w / 2)) < ((c.y - p.y) / p.h) * (p.w / 2);
  return true;
}

// ---------- shared ways of moving ------------------------------------------------
function floatMove(W, p, inp, dt, accel = 800, drag = 2.6) {
  let { ix, iy } = inp;
  const a = aimAt(p); if (a) ({ ix, iy } = a);
  const l = Math.hypot(ix, iy); if (l > 1) { ix /= l; iy /= l; }
  p.vx += ix * accel * dt; p.vy += iy * accel * dt;
  const d = Math.exp(-drag * dt); p.vx *= d; p.vy *= d;
  const nx = p.x + p.vx * dt;
  if (W.hits(nx, p.y, W.hw, W.hh)) { p.vx = 0; if (p.target) p.stuck = (p.stuck || 0) + dt; } else p.x = nx;
  const ny = p.y + p.vy * dt;
  if (W.hits(p.x, ny, W.hw, W.hh)) { p.vy = 0; if (p.target) p.stuck = (p.stuck || 0) + dt; } else p.y = ny;
  if (Math.abs(p.vx) > 20) p.face = Math.sign(p.vx);
}
function walkMove(W, p, inp, dt) {
  let ix = inp.ix, wantJump = inp.iy < 0;
  if (p.target) {
    const dx = p.target.x - p.x;
    if (Math.abs(dx) < 12) p.target = null; else ix = Math.sign(dx);
    if (p.target && p.target.y < p.y - 90 && p.s.blocked) wantJump = true;
  }
  p.vx = lerp(p.vx, ix * W.walk, ease(10, dt));
  if (wantJump && p.s.grounded) { p.vy = -W.jump; p.s.grounded = false; }
  p.vy += W.gravity * dt;
  const nx = clamp(p.x + p.vx * dt, W.x0 + 20, W.x1 - 20);
  p.s.blocked = W.groundAt(nx + Math.sign(p.vx) * W.hw) < p.y - W.stepUp;
  if (p.s.blocked) p.vx = 0; else p.x = nx;
  p.y += p.vy * dt;
  const g = W.groundAt(p.x);
  if (p.y >= g || (p.s.grounded && p.vy >= 0 && g - p.y < W.stepUp)) { p.y = g; p.vy = 0; p.s.grounded = true; } else p.s.grounded = false;
  if (Math.abs(p.vx) > 20) p.face = Math.sign(p.vx);
}

// =====================================================================
// 1. The House: a diver, swimming
// =====================================================================
const HOUSE = (() => {
  const W = 2600, H = 1900, WL = 470, GROUND = 1700;
  const P = {
    sky: '#bcd2e8', siding: '#e6ddc8', sidingLine: '#cfc4a8', roof: '#6b5a4e', roofLine: '#56483e',
    trim: '#d6a39b', red: '#e2552d', blue: '#2e62b0', green: '#2f8f4e', mint: '#8fcaa6', pink: '#e8b4ad', yellow: '#e8c547',
    grey: '#9b9b9b', greyLight: '#cdcac3', brown: '#6b4a3a', wood: '#a67a55', white: '#ffffff', cream: '#efe7d3', paper: PAPER,
  };
  const ROOMS = [
    { id: 'attic', x0: 224, x1: 2376, y0: 400, y1: 700, paper: '#dccdb0', pattern: 'planks', line: '#cbb996' },
    { id: 'parlor', x0: 224, x1: 1100, y0: 724, y1: 1024, paper: '#efdcd2', pattern: 'stripes', line: '#e2c7bb' },
    { id: 'kitchen', x0: 1118, x1: 2376, y0: 724, y1: 1024, paper: '#e3ead8', pattern: 'checks', line: '#d2dcc3' },
    { id: 'bath', x0: 224, x1: 800, y0: 1048, y1: 1348, paper: '#dbe7ec', pattern: 'tiles', line: '#c4d5dc' },
    { id: 'class', x0: 818, x1: 1800, y0: 1048, y1: 1348, paper: '#f1ead8', pattern: 'dado', line: P.blue },
    { id: 'bed', x0: 1818, x1: 2376, y0: 1048, y1: 1348, paper: '#ebe0e8', pattern: 'dots', line: '#d9c5d6' },
    { id: 'cellar', x0: 224, x1: 1300, y0: 1372, y1: 1672, paper: '#d6d1c6', pattern: 'bricks', line: '#c2bbad' },
    { id: 'hall', x0: 1318, x1: 2376, y0: 1372, y1: 1672, paper: '#ebe4d2', pattern: 'plain', line: '#ddd4bd' },
  ];
  const room = Object.fromEntries(ROOMS.map((r) => [r.id, r]));
  const SLABS = [{ y: 700, hatch: [1920, 2080] }, { y: 1024, hatch: [560, 720] }, { y: 1348, hatch: [1560, 1720] }];
  const WALLS = [{ x: 1100, y0: 724, y1: 1024 }, { x: 800, y0: 1048, y1: 1348 }, { x: 1800, y0: 1048, y1: 1348 }, { x: 1300, y0: 1372, y1: 1672 }];
  const DOOR_H = 150;
  const solids = [{ x: 0, y: 0, w: W, h: 400 }, { x: 0, y: 0, w: 224, h: H }, { x: 2376, y: 0, w: W - 2376, h: H }, { x: 0, y: 1672, w: W, h: H - 1672 }];
  for (const s of SLABS) { solids.push({ x: 224, y: s.y, w: s.hatch[0] - 224, h: 24 }); solids.push({ x: s.hatch[1], y: s.y, w: 2376 - s.hatch[1], h: 24 }); }
  for (const w of WALLS) solids.push({ x: w.x, y: w.y0, w: 18, h: w.y1 - w.y0 - DOOR_H });
  const hits = (x, y, hw, hh) => y - hh < WL + 2 || solids.some((s) => x + hw > s.x && x - hw < s.x + s.w && y + hh > s.y && y - hh < s.y + s.h);

  const things = [];
  const add = (type, props) => things.push({ type, ...props });
  add('suitcases', { x: 300, y: 700 });
  for (let i = 0; i < 14; i++) add('chair', { x: 640 + i * 82, y: 700, face: 1 });
  add('ladder', { x: 2000, y0: 724, y1: 1024 });
  add('sofa', { x: 480, y: 1024 }); add('lamp', { x: 690, y: 1024 }); add('sideTable', { x: 790, y: 1024 });
  add('window', { x: 900, y: 800 }); add('clock', { x: 1020, y: 1024 }); add('plant', { x: 270, y: 1024 });
  add('window', { x: 1260, y: 790 }); add('table', { x: 1380, y: 1024 });
  add('chair', { x: 1290, y: 1024, face: 1 }); add('chair', { x: 1470, y: 1024, face: -1 });
  add('fridge', { x: 1620, y: 1024 }); add('stove', { x: 1740, y: 1024 });
  add('counter', { x0: 2130, x1: 2350, y: 1024 }); add('shelf', { x0: 2140, x1: 2340, y: 850 });
  add('ladder', { x: 640, y0: 1048, y1: 1348 });
  add('tub', { x: 350, y: 1348 }); add('mirror', { x: 540, y: 1170 }); add('sink', { x: 540, y: 1348 });
  add('easel', { x: 930, y: 1348 });
  for (let i = 0; i < 4; i++) add('desk', { x: 1140 + i * 150, y: 1348 });
  add('picture', { x: 1500, y: 1140 }); add('pendant', { x: 1250, y: 1048 });
  add('ladder', { x: 1640, y0: 1372, y1: 1672 });
  add('bed', { x: 2010, y: 1348 }); add('nightstand', { x: 2180, y: 1348 }); add('window', { x: 2300, y: 1130 });
  add('boiler', { x: 330, y: 1672 }); add('boxes', { x: 560, y: 1672 }); add('washer', { x: 820, y: 1672 }); add('jars', { x0: 950, x1: 1250, y: 1520 });
  for (let i = 0; i < 9; i++) { const x = 1440 + i * 76; if (x > 1600 && x < 1690) continue; add('chair', { x, y: 1672, face: 1 }); }
  const splats = [];
  for (const r of ROOMS) {
    const n = r.id === 'hall' || r.id === 'attic' ? 5 : 2;
    for (let i = 0; i < n; i++) splats.push({ x: rr(r.x0 + 40, r.x1 - 40), y: rr(r.y0 + 30, r.y0 + 120), r: rr(6, 10), color: [P.red, P.blue, P.yellow, P.grey][i % 4], rot: rand() * 6 });
  }
  const KINDS = [
    { body: P.blue, fin: P.yellow, mark: 'stripe', markColor: P.paper, len: 46 },
    { body: P.yellow, fin: P.red, mark: 'dot', markColor: INK, len: 36 },
    { body: P.red, fin: INK, mark: 'stripe', markColor: P.paper, len: 34 },
    { body: P.greyLight, fin: P.blue, mark: 'line', markColor: P.blue, len: 28 },
    { body: P.mint, fin: P.green, mark: 'dot', markColor: P.paper, len: 40 },
    { body: P.pink, fin: P.red, mark: 'stripe', markColor: P.red, len: 38 },
  ];
  const LANES = [['attic', 570], ['parlor', 900], ['kitchen', 860], ['class', 1150], ['hall', 1470], ['cellar', 1440]];
  const schools = LANES.map(([id, y], i) => {
    const r = room[id], kind = KINDS[i], rows = 2 + (i % 2), cols = 3 + (i % 2);
    const members = [];
    for (let a = 0; a < rows; a++) for (let c = 0; c < cols; c++) members.push({ ox: c * kind.len * 1.5 + (a % 2) * kind.len * 0.75, oy: a * kind.len * 0.75, dx: 0, dy: 0, x: 0, y: 0 });
    const width = cols * kind.len * 1.5;
    return { kind, room: r, y, x: rr(r.x0 + width + 40, r.x1 - 60), dir: rand() < 0.5 ? -1 : 1, speed: rr(35, 60), members, width };
  });
  const jellies = [[1990, 1150], [2250, 1210], [720, 1470], [1080, 1450], [1950, 1450]].map(([x, y], i) => ({ hx: x, hy: y, x, y, s: rr(0.8, 1.1), color: [P.pink, P.paper, P.yellow][i % 3] }));
  const bubbles = [];
  const portals = [
    { to: 'night', shape: 'circle', x: 1300, y: 520, r: 44, exit: { x: 1300, y: 620 } },
    { to: 'stand', shape: 'rect', x: 370, y: 786, w: 140, h: 88, exit: { x: 440, y: 950 } },
    { to: 'shapes', shape: 'rect', x: 1693, y: 1158, w: 84, h: 190, exit: { x: 1640, y: 1280 } },
    { to: 'dune', shape: 'rect', x: 2228, y: 1502, w: 84, h: 170, exit: { x: 2150, y: 1600 } },
    { to: 'clock', shape: 'circle', x: 1020, y: 858, r: 24, exit: { x: 930, y: 930 } },
    { to: 'sky', shape: 'rect', x: 862, y: 752, w: 76, h: 96, exit: { x: 880, y: 910 } },
    { to: 'dark', shape: 'rect', x: 508, y: 1126, w: 64, h: 88, exit: { x: 470, y: 1270 } },
    { to: 'fridge', shape: 'rect', x: 1586, y: 862, w: 68, h: 158, exit: { x: 1520, y: 950 } },
  ];

  function fishDraw(x, y, kind, face, flick) {
    const L = kind.len, h = L * 0.42;
    ctx.save(); ctx.translate(x, y); ctx.scale(face, 1);
    ctx.fillStyle = kind.fin;
    ctx.beginPath(); ctx.moveTo(-L * 0.36, 0); ctx.lineTo(-L * 0.62, -h * 0.55 - flick); ctx.lineTo(-L * 0.62, h * 0.55 - flick); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-L * 0.1, -h * 0.4); ctx.lineTo(L * 0.06, -h * 0.85); ctx.lineTo(L * 0.16, -h * 0.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = kind.body;
    ctx.beginPath(); ctx.ellipse(0, 0, L * 0.42, h * 0.5, 0, 0, 7); ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = kind.markColor;
    if (kind.mark === 'stripe') { ctx.fillRect(-L * 0.08, -h, L * 0.1, h * 2); ctx.fillRect(L * 0.12, -h, L * 0.06, h * 2); }
    else if (kind.mark === 'dot') { for (const [dx, dy] of [[-0.18, -0.1], [-0.02, 0.12], [0.1, -0.08]]) { ctx.beginPath(); ctx.arc(dx * L, dy * L, L * 0.035, 0, 7); ctx.fill(); } }
    else ctx.fillRect(-L * 0.42, -1, L * 0.84, 2.5);
    ctx.restore();
    ctx.fillStyle = P.white; ctx.beginPath(); ctx.arc(L * 0.24, -h * 0.1, h * 0.17, 0, 7); ctx.fill();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(L * 0.26, -h * 0.1, h * 0.09, 0, 7); ctx.fill();
    ctx.restore();
  }
  function chair(x, y, face, color = P.brown) {
    ctx.save(); ctx.translate(x, y); ctx.scale(face, 1);
    ink(3.2, color);
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(12, -42); ctx.moveTo(14, 0); ctx.lineTo(-10, -42); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-18, -42); ctx.lineTo(16, -42); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-16, -42); ctx.lineTo(-20, -86); ctx.stroke();
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-19, -78); ctx.lineTo(-4, -78); ctx.moveTo(-18, -66); ctx.lineTo(-4, -66); ctx.stroke();
    ctx.restore();
  }
  function wallpaper(r) {
    ctx.fillStyle = r.paper;
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.fillStyle = r.line;
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    if (r.pattern === 'stripes') for (let x = r.x0 + 12; x < r.x1; x += 28) ctx.fillRect(x, r.y0, 8, h);
    else if (r.pattern === 'planks') for (let x = r.x0 + 40; x < r.x1; x += 40) ctx.fillRect(x, r.y0, 1.5, h);
    else if (r.pattern === 'checks') for (let y = r.y0; y < r.y1; y += 30) for (let x = r.x0 + ((y - r.y0) / 30 % 2) * 30; x < r.x1; x += 60) ctx.fillRect(x, y, 30, 30);
    else if (r.pattern === 'tiles') { for (let y = r.y0 + 30; y < r.y1; y += 30) ctx.fillRect(r.x0, y, w, 1.5); for (let x = r.x0 + 30; x < r.x1; x += 30) ctx.fillRect(x, r.y0, 1.5, h); }
    else if (r.pattern === 'dots') for (let y = r.y0 + 20; y < r.y1; y += 34) for (let x = r.x0 + 20 + ((y - r.y0) % 68 ? 17 : 0); x < r.x1; x += 34) { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fill(); }
    else if (r.pattern === 'bricks') for (let y = r.y0 + 20, k = 0; y < r.y1; y += 20, k++) { ctx.fillRect(r.x0, y, w, 1.5); for (let x = r.x0 + (k % 2) * 30; x < r.x1; x += 60) ctx.fillRect(x, y - 20, 1.5, 20); }
    else if (r.pattern === 'dado') ctx.fillRect(r.x0, r.y1 - 36, w, 36);
  }
  function thing(t, st) {
    const { x, y } = t;
    switch (t.type) {
      case 'chair': chair(x, y, t.face); break;
      case 'suitcases':
        box(x - 40, y - 36, 80, 36, P.brown); box(x - 34, y - 64, 68, 28, P.red); box(x - 26, y - 86, 52, 22, P.greyLight);
        ink(); for (const [yy, ww] of [[-36, 16], [-64, 14], [-86, 12]]) ctx.strokeRect(x - ww / 2, y + yy - 6, ww, 6);
        break;
      case 'window':
        box(x - 40, y - 50, 80, 100, P.sky, 2);
        ctx.fillStyle = P.white; ctx.fillRect(x - 36, y - 46, 72, 92);
        ctx.fillStyle = P.sky; for (const [cx, cy] of [[-34, -44], [2, -44], [-34, 2], [2, 2]]) ctx.fillRect(x + cx, y + cy, 32, 42);
        ctx.fillStyle = P.trim; ctx.fillRect(x - 48, y + 50, 96, 8);
        break;
      case 'picture':
        box(x - 46, y - 34, 92, 68, P.paper, 2);
        box(x - 30, y - 6, 26, 26, P.red, 1.2); circle(x + 18, y - 8, 12, P.blue, false); ctx.fillStyle = P.green; ctx.fillRect(x - 2, y + 6, 22, 14);
        break;
      case 'sofa':
        ctx.fillStyle = P.blue;
        ctx.beginPath(); ctx.roundRect(x - 110, y - 80, 220, 50, 10); ctx.fill();
        ctx.fillRect(x - 118, y - 40, 236, 30);
        ctx.beginPath(); ctx.roundRect(x - 126, y - 62, 22, 52, 8); ctx.roundRect(x + 104, y - 62, 22, 52, 8); ctx.fill();
        ctx.fillStyle = P.brown; ctx.fillRect(x - 108, y - 10, 8, 10); ctx.fillRect(x + 100, y - 10, 8, 10);
        ink(1.2); ctx.beginPath(); ctx.moveTo(x, y - 76); ctx.lineTo(x, y - 12); ctx.stroke();
        break;
      case 'lamp':
        ctx.fillStyle = INK; ctx.fillRect(x - 1.5, y - 150, 3, 150); ctx.fillRect(x - 16, y - 4, 32, 4);
        poly([[x - 16, y - 150], [x + 16, y - 150], [x + 26, y - 186], [x - 26, y - 186]], P.yellow); ink(1.2); ctx.stroke();
        break;
      case 'sideTable': ctx.fillStyle = P.wood; ctx.fillRect(x - 30, y - 60, 60, 8); ctx.fillRect(x - 26, y - 52, 5, 52); ctx.fillRect(x + 21, y - 52, 5, 52); break;
      case 'clock': {
        box(x - 30, y - 200, 60, 200, P.wood);
        const sw = (Math.floor(st * 2) % 2) ? 8 : -8;
        ink(1.5); ctx.beginPath(); ctx.moveTo(x, y - 128); ctx.lineTo(x + sw, y - 60); ctx.stroke();
        circle(x + sw, y - 56, 7, P.yellow);
        break;
      }
      case 'plant': box(x - 18, y - 36, 36, 36, P.red); ctx.fillStyle = TEX.plant; ctx.beginPath(); ctx.ellipse(x, y - 80, 30, 46, 0, 0, 7); ctx.fill(); break;
      case 'table':
        ctx.fillStyle = P.wood; ctx.fillRect(x - 90, y - 64, 180, 8); ctx.fillRect(x - 84, y - 56, 6, 56); ctx.fillRect(x + 78, y - 56, 6, 56);
        ctx.fillStyle = P.red; ctx.fillRect(x - 70, y - 72, 22, 8);
        break;
      case 'fridge':
        ctx.fillStyle = P.white; ctx.beginPath(); ctx.roundRect(x - 38, y - 166, 76, 166, 8); ctx.fill(); ink(1.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 38, y - 110); ctx.lineTo(x + 38, y - 110); ctx.stroke();
        ctx.fillStyle = INK; ctx.fillRect(x + 24, y - 150, 4, 26); ctx.fillRect(x + 24, y - 96, 4, 34);
        break;
      case 'stove': box(x - 40, y - 80, 80, 80, P.greyLight); box(x - 28, y - 60, 56, 40, INK); ctx.fillStyle = INK; ctx.fillRect(x - 30, y - 84, 24, 4); ctx.fillRect(x + 6, y - 84, 24, 4); break;
      case 'counter':
        ctx.fillStyle = P.mint; ctx.fillRect(t.x0, y - 76, t.x1 - t.x0, 76); ctx.fillStyle = P.paper; ctx.fillRect(t.x0 - 6, y - 82, t.x1 - t.x0 + 12, 8);
        ink(1.2); for (let xx = t.x0; xx < t.x1; xx += 55) ctx.strokeRect(xx + 4, y - 68, 47, 60);
        break;
      case 'shelf':
        ctx.fillStyle = P.wood; ctx.fillRect(t.x0, y, t.x1 - t.x0, 6);
        for (let xx = t.x0 + 16, k = 0; xx < t.x1 - 10; xx += 30, k++) { ctx.fillStyle = [P.paper, P.blue, P.red][k % 3]; ctx.beginPath(); ctx.arc(xx, y - 12, 12, Math.PI, 0); ctx.fill(); ctx.fillRect(xx - 12, y - 12, 24, 12); }
        break;
      case 'ladder':
        ink(2.2, P.brown);
        ctx.beginPath(); ctx.moveTo(x - 18, t.y0); ctx.lineTo(x - 18, t.y1); ctx.moveTo(x + 18, t.y0); ctx.lineTo(x + 18, t.y1); ctx.stroke();
        for (let yy = t.y0 + 22; yy < t.y1; yy += 26) { ctx.beginPath(); ctx.moveTo(x - 18, yy); ctx.lineTo(x + 18, yy); ctx.stroke(); }
        break;
      case 'tub':
        ctx.fillStyle = P.white; ctx.beginPath(); ctx.moveTo(x - 100, y - 70); ctx.lineTo(x + 100, y - 70); ctx.lineTo(x + 90, y - 22); ctx.quadraticCurveTo(x, y - 8, x - 90, y - 22); ctx.closePath(); ctx.fill(); ink(1.6); ctx.stroke();
        ctx.fillStyle = INK; for (const dx of [-76, 76]) ctx.fillRect(x + dx - 4, y - 18, 8, 18);
        ctx.fillStyle = P.greyLight; ctx.fillRect(x - 108, y - 110, 6, 40); ctx.fillRect(x - 108, y - 110, 24, 6);
        break;
      case 'mirror': box(x - 34, y - 46, 68, 92, '#d8e8f0', 2); ctx.fillStyle = P.white; ctx.fillRect(x - 20, y - 36, 6, 50); break;
      case 'sink':
        poly([[x - 36, y - 80], [x + 36, y - 80], [x + 28, y - 60], [x - 28, y - 60]], P.white); ink(1.5); ctx.stroke();
        box(x - 8, y - 60, 16, 60, P.greyLight, 1.2);
        break;
      case 'easel':
        ink(3, P.wood);
        ctx.beginPath(); ctx.moveTo(x - 50, y); ctx.lineTo(x, y - 190); ctx.lineTo(x + 50, y); ctx.moveTo(x, y - 190); ctx.lineTo(x + 6, y); ctx.stroke();
        box(x - 60, y - 170, 120, 90, INK, 1);
        ink(1.6, P.paper); ctx.beginPath(); ctx.moveTo(x - 40, y - 150); ctx.lineTo(x - 30, y - 158); ctx.lineTo(x - 30, y - 128); ctx.moveTo(x - 10, y - 156); ctx.lineTo(x + 6, y - 156); ctx.lineTo(x - 6, y - 130); ctx.stroke();
        break;
      case 'desk':
        box(x - 46, y - 58, 92, 6, P.paper, 1.4);
        ctx.fillStyle = INK; ctx.fillRect(x - 42, y - 52, 3, 52); ctx.fillRect(x + 39, y - 52, 3, 52);
        ctx.fillStyle = P.red; ctx.fillRect(x + 14, y - 64, 20, 6);
        chair(x + 60, y, -1, INK);
        break;
      case 'pendant':
        ink(1.2); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 60); ctx.stroke();
        ctx.fillStyle = P.paper; ctx.beginPath(); ctx.arc(x, y + 76, 16, Math.PI, 0); ctx.closePath(); ctx.fill(); ink(1.4); ctx.stroke();
        break;
      case 'bed':
        ctx.fillStyle = P.wood; ctx.fillRect(x - 120, y - 100, 10, 100); ctx.fillRect(x + 110, y - 70, 10, 70);
        ctx.fillStyle = P.paper; ctx.fillRect(x - 110, y - 58, 220, 28);
        ctx.fillStyle = P.red; ctx.fillRect(x - 40, y - 64, 150, 34);
        ctx.fillStyle = P.white; ctx.beginPath(); ctx.roundRect(x - 106, y - 72, 54, 16, 7); ctx.fill(); ink(1.2); ctx.stroke();
        ctx.fillStyle = P.wood; ctx.fillRect(x - 110, y - 30, 220, 10);
        break;
      case 'nightstand': box(x - 26, y - 50, 52, 50, P.wood, 1.2); ctx.fillStyle = INK; ctx.fillRect(x - 5, y - 30, 10, 3); break;
      case 'boiler': {
        ctx.fillStyle = P.greyLight; ctx.beginPath(); ctx.roundRect(x - 56, y - 180, 112, 180, [40, 40, 0, 0]); ctx.fill(); ink(1.6); ctx.stroke();
        box(x - 22, y - 80, 44, 36, INK, 1.2);
        const alt = Math.floor(st * 3) % 2;
        ctx.fillStyle = P.red; ctx.beginPath(); ctx.moveTo(x - 20, y - 46);
        for (let k = 0; k <= 5; k++) ctx.lineTo(x - 20 + k * 8, y - 46 - (k % 2 === alt ? 26 : 12));
        ctx.lineTo(x + 20, y - 46); ctx.closePath(); ctx.fill();
        ctx.fillStyle = INK; ctx.fillRect(x - 4, y - 260, 8, 80);
        break;
      }
      case 'boxes': box(x - 60, y - 56, 70, 56, P.wood, 1.3); box(x + 10, y - 50, 56, 50, P.wood, 1.3); box(x - 34, y - 104, 70, 48, P.wood, 1.3); break;
      case 'washer': box(x - 42, y - 96, 84, 96, P.white, 1.6); circle(x, y - 44, 26, P.blue); circle(x, y - 44, 16, '#d8e8f0'); ctx.fillStyle = INK; ctx.fillRect(x - 32, y - 88, 18, 6); break;
      case 'jars':
        ctx.fillStyle = P.wood; ctx.fillRect(t.x0, y, t.x1 - t.x0, 6);
        for (let xx = t.x0 + 20, k = 0; xx < t.x1 - 10; xx += 36, k++) { box(xx - 11, y - 34, 22, 34, [P.yellow, P.red, P.mint][k % 3], 1.1); ctx.fillStyle = INK; ctx.fillRect(xx - 11, y - 40, 22, 6); }
        break;
    }
  }
  function portalFrames() {
    box(362, 778, 156, 104, '#8a6a4a', 2);
    box(1693 - 26, 1158, 26, 190, P.mint, 1.4); box(1777, 1158, 26, 190, P.mint, 1.4);
    box(2312, 1502, 30, 170, P.red, 1.6); circle(2334, 1590, 3.5, P.yellow, false);
    ctx.fillStyle = P.yellow; ctx.fillRect(2220, 1668, 100, 4);
    ctx.lineWidth = 7; ctx.strokeStyle = P.trim; ctx.beginPath(); ctx.arc(1300, 520, 48, 0, 7); ctx.stroke();
    ctx.lineWidth = 5; ctx.strokeStyle = '#8a6a4a'; ctx.beginPath(); ctx.arc(1020, 858, 27, 0, 7); ctx.stroke();
  }
  function shell(st) {
    ctx.fillStyle = P.roof;
    ctx.beginPath(); ctx.moveTo(150, 410); ctx.lineTo(1300, 90); ctx.lineTo(2450, 410); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle = P.roofLine; for (let y = 110; y < 410; y += 22) ctx.fillRect(0, y, W, 2); ctx.restore();
    poly([[150, 410], [1300, 90], [2450, 410], [2450, 400], [1300, 78], [150, 400]], P.trim);
    ctx.fillStyle = P.red; ctx.fillRect(1760, 150, 90, 120);
    ink(1); for (let y = 170; y < 270; y += 18) { ctx.beginPath(); ctx.moveTo(1760, y); ctx.lineTo(1850, y); ctx.stroke(); }
    const alt = Math.floor(st * 3) % 2;
    ctx.fillStyle = P.red; ctx.beginPath(); ctx.moveTo(1760, 150);
    for (let k = 0; k <= 8; k++) ctx.lineTo(1760 + k * 11.25, 150 - (k % 2 === alt ? 34 : 12));
    ctx.lineTo(1850, 150); ctx.closePath(); ctx.fill();
    for (const x of [200, 2376]) { ctx.fillStyle = P.siding; ctx.fillRect(x, 400, 24, 1300); ctx.fillStyle = P.sidingLine; for (let y = 412; y < 1700; y += 12) ctx.fillRect(x, y, 24, 1.5); }
    ctx.fillStyle = P.siding;
    for (const s of SLABS) { ctx.fillRect(224, s.y, s.hatch[0] - 224, 24); ctx.fillRect(s.hatch[1], s.y, 2376 - s.hatch[1], 24); }
    for (const w of WALLS) ctx.fillRect(w.x, w.y0, 18, w.y1 - w.y0 - DOOR_H);
    ctx.fillStyle = P.trim;
    for (const s of SLABS) { ctx.fillRect(224, s.y + 24, s.hatch[0] - 224, 4); ctx.fillRect(s.hatch[1], s.y + 24, 2376 - s.hatch[1], 4); }
    for (const w of WALLS) ctx.fillRect(w.x - 4, w.y1 - DOOR_H, 26, 6);
    ctx.fillStyle = '#c9c1ab'; ctx.fillRect(200, 1672, 2200, 28);
    ink(1.5); ctx.strokeRect(200, 400, 2200, 1300);
  }
  const clouds = [{ x: 420, y: 150 }, { x: 1700, y: 110 }, { x: 2350, y: 220 }].map((c) => ({ ...c, parts: Array.from({ length: 5 }, (_, k) => ({ dx: k * 32 - 64 + rr(-6, 6), dy: rr(-8, 8), rx: rr(36, 56), ry: rr(12, 18) })) }));

  return {
    id: 'house', name: 'The House', swatch: ['#bcd2e8', '#efdcd2', '#e2552d'], bg: P.sky, viewH: 760,
    x0: 0, y0: 0, x1: W, y1: H, hw: 30, hh: 12, spawn: { x: 520, y: WL + 20 }, portals,
    hint: 'You are a diver. Swim with the arrows. Anything glowing (a window, the fridge, the bathroom mirror, a painting, the clock) leads elsewhere.',
    hits,
    move(p, inp, dt) { floatMove(this, p, inp, dt); },
    update(dt, t, frame, p) {
      for (const s of schools) {
        s.x += s.dir * s.speed * dt;
        if (s.dir > 0 && s.x > s.room.x1 - 40) { s.dir = -1; s.x = s.room.x1 - 40 - s.width; }
        if (s.dir < 0 && s.x < s.room.x0 + 40) { s.dir = 1; s.x = s.room.x0 + 40 + s.width; }
        for (const m of s.members) {
          const px = s.x - s.dir * m.ox + m.dx, py = s.y + m.oy + m.dy;
          const ddx = px - p.x, ddy = py - p.y, d = Math.hypot(ddx, ddy);
          if (d < 130 && d > 1) { m.dx += ddx / d * (130 - d) * 3 * dt; m.dy += ddy / d * (130 - d) * 3 * dt; }
          const k = Math.exp(-1.5 * dt);
          m.dx *= k; m.dy *= k;
          m.x = clamp(px, s.room.x0 + 20, s.room.x1 - 20);
          m.y = clamp(py, Math.max(s.room.y0 + 16, WL + 12), s.room.y1 - 16);
        }
      }
      for (const j of jellies) { j.x = j.hx; j.y = j.hy + (frame % 4 < 2 ? -5 : 5); }
      p.s.breath = (p.s.breath ?? 3) - dt;
      if (p.s.breath < 0) { p.s.breath = rr(3, 4.5); for (let i = 0; i < 5; i++) bubbles.push({ x: p.x + p.face * 34, y: p.y - 12 - i * 8, r: rr(2.5, 5), vy: rr(45, 75) }); }
      for (const b of bubbles) b.y -= b.vy * dt;
      for (let i = bubbles.length - 1; i >= 0; i--) { const b = bubbles[i]; if (b.y < WL + 4 || solids.some((s) => b.x > s.x && b.x < s.x + s.w && b.y > s.y && b.y < s.y + s.h)) bubbles.splice(i, 1); }
    },
    draw(t, frame, st) {
      ctx.fillStyle = P.sky; ctx.fillRect(0, 0, W, GROUND);
      ctx.fillStyle = TEX.cloud;
      for (const c of clouds) { ctx.beginPath(); for (const q of c.parts) { ctx.moveTo(c.x + q.dx + q.rx, c.y + q.dy); ctx.ellipse(c.x + q.dx, c.y + q.dy, q.rx, q.ry, 0, 0, 7); } ctx.fill(); }
      ctx.fillStyle = P.brown; ctx.fillRect(96, 180, 12, GROUND - 180); ctx.fillRect(66, 204, 72, 6);
      ctx.fillStyle = TEX.lawn; ctx.fillRect(0, GROUND, W, H - GROUND);
      for (let k = 0; k < 6; k++) { const x = 2440 + k * 22; poly([[x, GROUND], [x, GROUND - 70], [x + 7, GROUND - 80], [x + 14, GROUND - 70], [x + 14, GROUND]], P.white); }
      ctx.fillStyle = P.white; ctx.fillRect(2436, GROUND - 56, 136, 7); ctx.fillRect(2436, GROUND - 26, 136, 7);
      for (const r of ROOMS) wallpaper(r);
      for (const s of splats) splat(s.x, s.y, s.r, s.color, s.rot);
      for (const th of things) thing(th, st);
      portalFrames();
      for (const q of portals) drawPortal(q, frame);
      ctx.fillStyle = 'rgba(70, 130, 185, 0.2)';
      for (const r of ROOMS) { const top = Math.max(r.y0, WL); if (top < r.y1) ctx.fillRect(r.x0, top, r.x1 - r.x0, r.y1 - top); }
      for (const s of SLABS) ctx.fillRect(s.hatch[0], s.y, s.hatch[1] - s.hatch[0], 24);
      for (const w of WALLS) ctx.fillRect(w.x, w.y1 - DOOR_H, 18, DOOR_H);
      ink(1.4); ctx.beginPath(); ctx.moveTo(224, WL); ctx.lineTo(2376, WL); ctx.stroke();
      ink(1.2); for (let x = 250; x < 2360; x += 36) { ctx.beginPath(); ctx.moveTo(x - 4, WL + 6); ctx.lineTo(x, WL + 11); ctx.lineTo(x + 4, WL + 6); ctx.stroke(); }
      shell(st);
      for (const j of jellies) {
        const r = 20 * j.s;
        ink(1.3);
        for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(j.x + k * r * 0.36, j.y); ctx.lineTo(j.x + k * r * 0.36, j.y + (k % 2 ? 32 : 44) * j.s); ctx.stroke(); }
        ctx.fillStyle = j.color; ctx.beginPath(); ctx.arc(j.x, j.y, r, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      const flick = frame % 2 ? 2 : -2;
      for (const s of schools) for (const m of s.members) fishDraw(m.x, m.y, s.kind, s.dir, flick);
      ink(1); ctx.fillStyle = P.white;
      for (const b of bubbles) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); ctx.stroke(); }
    },
    avatar(p, frame, moving) {
      const k = moving ? (frame % 2 ? 1 : -1) : 0;
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(p.face, 1);
      for (const [oy, swing] of [[-3, 0.1 + k * 0.15], [4, -0.06 - k * 0.15]]) {
        ctx.save(); ctx.translate(-22, oy); ctx.rotate(swing);
        ctx.fillStyle = INK; ctx.fillRect(-28, -3.5, 30, 7);
        poly([[-26, -3], [-46, -10], [-44, 7]], INK);
        ctx.restore();
      }
      box(-22, -19, 34, 9, P.greyLight, 1.1);
      ctx.fillStyle = P.red; ctx.beginPath(); ctx.roundRect(-25, -10, 48, 19, 9); ctx.fill();
      ctx.fillStyle = INK; ctx.fillRect(-5, -10, 3, 19);
      ctx.save(); ctx.translate(13, 3); ctx.rotate(0.3 - k * 0.1); ctx.fillStyle = P.red; ctx.fillRect(0, -3, 19, 6); circle(21, 0, 4, P.cream, false); ctx.restore();
      circle(30, -5, 9.5, P.cream, false);
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(28.5, -7, 10, Math.PI * 0.9, Math.PI * 1.95); ctx.closePath(); ctx.fill();
      box(32, -10, 9, 7, P.blue, 1.1);
      ctx.restore();
    },
  };
})();

// =====================================================================
// 2. The Night Sky: a lantern-bearer, drifting
// =====================================================================
const NIGHT = (() => {
  const W = 4200, H = 2600;
  const P = { bands: ['#10163a', '#151d48', '#1b2456', '#222c63', '#29346f'], star: '#f4e9b8', moon: '#f1e6c8', crater: '#d9cba6', rock: '#5b4a6e', grass: '#3e8a6a', lamp: '#ffd66b', pink: '#f2a6a0', ochre: '#e3a33a' };
  const stars = Array.from({ length: 700 }, () => ({ x: rr(0, W), y: rr(0, H), s: rr(0.8, 2.4), ph: Math.floor(rr(0, 4)) }));
  const islands = [];
  for (let i = 0; i < 11; i++) islands.push({ x: 300 + i * 360 + rr(-60, 60), y: rr(600, 2200), w: rr(120, 220), kind: pick(['lamp', 'house', 'tree', 'chair']) });
  const comets = [];
  const portals = [
    { to: 'house', shape: 'circle', x: 520, y: 1400, r: 50, exit: { x: 660, y: 1400 }, frame: true },
    { to: 'orbit', shape: 'circle', x: 2600, y: 760, r: 70, exit: { x: 2600, y: 920 }, galaxy: true },
    { to: 'mirror', shape: 'rect', x: 3500, y: 1640, w: 110, h: 170, exit: { x: 3420, y: 1900 }, mirror: true },
    { to: 'sky', shape: 'rect', x: 1500, y: 2360, w: 170, h: 120, exit: { x: 1585, y: 2240 } },
  ];
  return {
    id: 'night', name: 'The Night Sky', swatch: ['#1b2456', '#2d3a7a', '#f4e9b8'], bg: P.bands[0], viewH: 760,
    x0: 0, y0: 0, x1: W, y1: H, hw: 16, hh: 20, spawn: { x: 640, y: 1400 }, portals,
    hint: 'You carry a lantern. Drift with the arrows; stars reach out to you.',
    hits: (x, y, hw, hh) => x < hw || y < hh || x > W - hw || y > H - hh,
    move(p, inp, dt) { floatMove(this, p, inp, dt, 600, 0.8); },
    update(dt) {
      if (rand() < dt * 0.35) comets.push({ x: view.x + rr(0, view.w), y: view.y - 40, vx: rr(260, 420), vy: rr(160, 260), life: 3 });
      for (const c of comets) { c.x += c.vx * dt; c.y += c.vy * dt; c.life -= dt; }
      for (let i = comets.length - 1; i >= 0; i--) if (comets[i].life < 0) comets.splice(i, 1);
    },
    draw(t, frame, st, p) {
      const bh = H / P.bands.length;
      P.bands.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(view.x - 20, i === 0 ? -2000 : i * bh, view.w + 40, i === P.bands.length - 1 ? 4000 : bh + (i === 0 ? 2000 : 0)); });
      const mx = par(2400, 0.15), my = 520 + view.y * 0.85;
      circle(mx, my, 230, P.moon, false);
      for (const [dx, dy, r] of [[-80, -40, 40], [60, 50, 28], [20, -110, 18], [-30, 110, 24], [110, -60, 14]]) circle(mx + dx, my + dy, r, P.crater, false);
      const px = par(3400, 0.3), py = 1500 + view.y * 0.7;
      circle(px, py, 70, P.ochre, false); ink(5, P.pink); ctx.beginPath(); ctx.ellipse(px, py, 120, 22, -0.3, 0, 7); ctx.stroke();
      circle(par(900, 0.25), 700 + view.y * 0.75, 26, '#d2472c', false);
      ctx.fillStyle = P.star;
      for (const s of stars) {
        if (s.x < view.x - 10 || s.x > view.x + view.w + 10 || s.y < view.y - 10 || s.y > view.y + view.h + 10) continue;
        const r = (frame + s.ph) % 4 === 0 ? s.s * 1.8 : s.s;
        ctx.fillRect(s.x - r / 2, s.y - r / 2, r, r);
      }
      const near = stars.filter((s) => Math.abs(s.x - p.x) < 260 && Math.abs(s.y - p.y) < 260).map((s) => [Math.hypot(s.x - p.x, s.y - p.y), s]).sort((a, b) => a[0] - b[0]).slice(0, 4);
      ink(1, 'rgba(244, 233, 184, 0.55)'); ctx.beginPath();
      for (const [, s] of near) { ctx.moveTo(p.x, p.y); ctx.lineTo(s.x, s.y); }
      ctx.stroke();
      ink(2, '#ffffff');
      for (const c of comets) { ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x - c.vx * 0.3, c.y - c.vy * 0.3); ctx.stroke(); circle(c.x, c.y, 4, '#ffffff', false); }
      for (const is of islands) {
        if (!visible(is.x, 300)) continue;
        const bob = (frame % 6 < 3 ? -3 : 3);
        const x = is.x, y = is.y + bob, w = is.w;
        poly([[x - w / 2, y], [x + w / 2, y], [x + w * 0.1, y + w * 0.7], [x - w * 0.15, y + w * 0.55]], P.rock);
        ctx.fillStyle = P.grass; ctx.fillRect(x - w / 2, y - 8, w, 10);
        if (is.kind === 'lamp') { ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x - 2, y - 90, 4, 82); circle(x, y - 96, 26, 'rgba(255, 214, 107, 0.25)', false); circle(x, y - 96, 9, P.lamp, false); }
        else if (is.kind === 'house') { ctx.fillStyle = '#e8dcc6'; ctx.fillRect(x - 26, y - 46, 52, 40); poly([[x - 32, y - 46], [x, y - 72], [x + 32, y - 46]], '#b5584a'); ctx.fillStyle = P.lamp; ctx.fillRect(x - 8, y - 34, 14, 14); }
        else if (is.kind === 'tree') { ctx.fillStyle = '#6b4a3a'; ctx.fillRect(x - 3, y - 60, 6, 52); circle(x, y - 74, 30, '#2f6b54', false); for (let i = 0; i < 5; i++) circle(x - 18 + i * 9, y - 76 + (i % 2) * 12, 4, P.pink, false); }
        else { ink(3, '#e8dcc6'); ctx.beginPath(); ctx.moveTo(x - 12, y - 8); ctx.lineTo(x + 10, y - 44); ctx.moveTo(x + 12, y - 8); ctx.lineTo(x - 8, y - 44); ctx.moveTo(x - 14, y - 44); ctx.lineTo(x + 14, y - 44); ctx.moveTo(x - 12, y - 44); ctx.lineTo(x - 16, y - 80); ctx.stroke(); }
      }
      // portal dressing: the attic window's frame, a spiral of stars, a hanging mirror's gilt frame
      const g = portals[1];
      ink(3, P.star);
      ctx.beginPath(); for (let a = 0; a < 18; a += 0.2) { const r = 12 + a * 7; ctx.lineTo(g.x + Math.cos(a + frame * 0.2) * r, g.y + Math.sin(a + frame * 0.2) * r * 0.6); } ctx.stroke();
      const m = portals[2]; ink(1.5, P.ochre); ctx.beginPath(); ctx.moveTo(m.x + m.w / 2, m.y - 200); ctx.lineTo(m.x + m.w / 2, m.y); ctx.stroke();
      ctx.lineWidth = 8; ctx.strokeRect(m.x - 5, m.y - 5, m.w + 10, m.h + 10);
      for (const q of portals) drawPortal(q, frame);
      ink(7, '#d6a39b'); ctx.beginPath(); ctx.arc(portals[0].x, portals[0].y, portals[0].r + 3, 0, 7); ctx.stroke();
    },
    avatar(p, frame) {
      circle(p.x + p.face * 18, p.y + 6, 44, 'rgba(255, 230, 150, 0.14)', false);
      ctx.save(); ctx.translate(p.x, p.y + (frame % 4 < 2 ? -2 : 2)); ctx.scale(p.face, 1);
      poly([[-12, -14], [12, -14], [16, 26], [-16, 26]], '#e9e2cf');
      circle(0, -24, 10, '#f1e6c8', false);
      ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-12, -36, 24, 6); ctx.fillRect(-7, -48, 14, 13);
      ink(2, '#1a1a1a'); ctx.beginPath(); ctx.moveTo(10, -6); ctx.lineTo(18, 4); ctx.stroke();
      box(12, 4, 12, 16, P.lamp, 1.2);
      ctx.restore();
    },
  };
})();

// =====================================================================
// 3. The Long Day: a desert crossed from dawn (left) to night (right).
//    You are a sand serpent: you swim through the sand and leap out of it.
//    Under the sand the arrows steer; in the air you fall back in an arc.
// =====================================================================
const DUNE = (() => {
  const W = 7200, H = 1700, HORIZON = 860;
  const surface = (x) => 1000 + Math.sin(x * 0.0011) * 90 + Math.sin(x * 0.0029 + 2) * 40;
  // the time of day at each point of the crossing: sky, sand, and ink colours
  const KEYS = [
    { t: 0.0, sky: [243, 214, 200], sand: [232, 201, 168], far: [214, 170, 160] },
    { t: 0.35, sky: [214, 229, 236], sand: [239, 220, 184], far: [206, 190, 170] },
    { t: 0.65, sky: [236, 170, 128], sand: [217, 154, 114], far: [184, 112, 96] },
    { t: 1.0, sky: [38, 42, 76], sand: [74, 70, 96], far: [52, 50, 80] },
  ];
  const mix = (a, b, u) => a.map((v, i) => Math.round(v + (b[i] - v) * u));
  function colorsAt(tday) {
    tday = Math.round(clamp(tday, 0, 1) * 24) / 24;          // the light changes in steps, like hours
    let k = 0; while (k < KEYS.length - 2 && tday > KEYS[k + 1].t) k++;
    const a = KEYS[k], b = KEYS[k + 1], u = (tday - a.t) / (b.t - a.t);
    const rgb = (key) => `rgb(${mix(a[key], b[key], clamp(u, 0, 1)).join(',')})`;
    return { sky: rgb('sky'), sand: rgb('sand'), far: rgb('far'), dark: tday > 0.8 };
  }
  const grain = stipple(null, ['rgba(120, 80, 50, 0.25)', 'rgba(255, 255, 255, 0.3)', 'rgba(90, 60, 40, 0.2)'], 900, 96, 0.5, 1.3, 71);
  const obelisks = []; for (let x = 500; x < W - 300; x += 600) obelisks.push({ x, h: 300 });
  const stars = Array.from({ length: 220 }, () => ({ x: rr(0, W), y: rr(0, HORIZON), s: rr(1.5, 3.5) }));
  const buried = Array.from({ length: 26 }, (_, i) => ({ x: 200 + i * 270 + rr(-40, 40), d: rr(120, 480), kind: i % 3, rot: rand() * 3 }));
  const portals = [
    { to: 'house', shape: 'circle', x: 760, y: surface(760) + 280, r: 62, exit: { x: 980, y: surface(980) + 200 } },
    { to: 'shapes', shape: 'tri', x: 2530, y: surface(2600) + 220, w: 150, h: 130, exit: { x: 2800, y: surface(2800) + 200 } },
    { to: 'sky', shape: 'circle', x: 3600, y: surface(3600) - 230, r: 80, exit: { x: 3760, y: surface(3760) + 120 } },
    { to: 'stand', shape: 'rect', x: 4700, y: surface(4760) + 200, w: 110, h: 110, exit: { x: 4960, y: surface(4960) + 200 } },
    { to: 'dark', shape: 'rect', x: 6400, y: surface(6450) + 220, w: 90, h: 130, exit: { x: 6250, y: surface(6250) + 200 } },
  ];
  const SEG = 18;
  return {
    id: 'dune', name: 'The Long Day', swatch: ['#efdcb8', '#e9a07c', '#262a4c'], bg: '#f3d6c8', viewH: 1000,
    x0: 0, y0: 0, x1: W, y1: H, spawn: { x: 980, y: surface(980) + 200 }, portals,
    hint: 'You are a sand serpent. Swim through the sand with the arrows and leap out of it. Dawn is left, night is right.',
    place(p, spot) { p.x = spot.x; p.y = spot.y; p.vx = 160; p.vy = -40; p.s.body = Array.from({ length: SEG * 4 }, (_, i) => ({ x: spot.x - i * 5, y: spot.y })); p.s.spray = []; },
    move(p, inp, dt) {
      const s = p.s, g = surface(p.x), under = p.y > g;
      let { ix, iy } = inp;
      const a = aimAt(p, 30); if (a) ({ ix, iy } = a);
      if (under) {
        p.vx += ix * 1000 * dt; p.vy += iy * 1000 * dt;
        p.vx *= Math.exp(-1.1 * dt); p.vy *= Math.exp(-1.1 * dt);
        const sp = Math.hypot(p.vx, p.vy);
        if (sp < 170) { const k = 170 / Math.max(sp, 1); p.vx = (p.vx || p.face) * k; p.vy *= k; }   // it never stops swimming
        if (sp > 700) { p.vx *= 700 / sp; p.vy *= 700 / sp; }
      } else {
        p.vy += 900 * dt; p.vx += ix * 150 * dt;
      }
      const wasUnder = s.under;
      p.x = clamp(p.x + p.vx * dt, 40, W - 40); p.y = clamp(p.y + p.vy * dt, 60, H - 60);
      if (p.x <= 40 || p.x >= W - 40) p.vx = -p.vx;
      if (p.y >= H - 60) p.vy = -Math.abs(p.vy);
      s.under = p.y > surface(p.x);
      if (wasUnder && !s.under && p.vy < 0) p.vy *= 1.6;   // breaching: the sand throws you up
      if (wasUnder !== undefined && wasUnder !== s.under) for (let i = 0; i < 16; i++) s.spray.push({ x: p.x, y: surface(p.x), vx: rr(-160, 160) + p.vx * 0.3, vy: rr(-420, -160), life: rr(0.5, 0.9) });
      for (const d of s.spray) { d.vy += 1300 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt; }
      s.spray = s.spray.filter((d) => d.life > 0);
      if (Math.abs(p.vx) > 20) p.face = Math.sign(p.vx);
      // the body follows the head's path
      const b = s.body; b.unshift({ x: p.x, y: p.y }); b.length = SEG * 4;
    },
    update() {},
    draw(t, frame, st, p) {
      const tday = (view.x + view.w / 2) / W;
      const C = colorsAt(tday);
      const top = view.y - 20, bot = view.y + view.h + 20, x0 = view.x - 20, x1 = view.x + view.w + 20;
      ctx.fillStyle = C.sky; ctx.fillRect(x0, top, x1 - x0, bot - top);
      if (C.dark) { ctx.fillStyle = '#f4e9b8'; for (const s of stars) if (s.x > x0 && s.x < x1) ctx.fillRect(s.x, s.y, s.s, s.s); }
      // the sun (or moon) rides an arc overhead as the day passes
      const arc = Math.PI * clamp(tday / 0.85, 0, 1);
      const sx = view.x + view.w * 0.5 - Math.cos(arc) * view.w * 0.42, sy = HORIZON - Math.sin(arc) * 520;
      if (!C.dark) circle(sx, sy, 90, '#fff4dc', false);
      else { circle(view.x + view.w * 0.7, 260, 70, '#f1e6c8', false); circle(view.x + view.w * 0.7 + 26, 250, 62, C.sky, false); }
      // a flat far range, then the mirage: a shimmering strip that repeats the obelisks upside down
      ctx.fillStyle = C.far; ctx.fillRect(x0, HORIZON - 40, x1 - x0, bot - HORIZON + 40);
      ctx.fillStyle = C.sky; ctx.globalAlpha = 0.55; ctx.fillRect(x0, HORIZON, x1 - x0, 60); ctx.globalAlpha = 1;
      for (const o of obelisks) {
        if (o.x < x0 - 400 || o.x > x1 + 400) continue;
        const mx = par(o.x, 0.5), wob = frame % 2 ? 2 : -2;
        ctx.globalAlpha = 0.35; ctx.fillStyle = C.far;
        for (let k = 0; k < 6; k++) ctx.fillRect(mx - 8 + (k % 2 ? wob : -wob), HORIZON + 4 + k * 8, 16, 5);
        ctx.globalAlpha = 1;
      }
      // the sand, with strata you can swim through
      const sandPath = () => { ctx.beginPath(); ctx.moveTo(x0, bot + 200); for (let x = x0; x <= x1; x += 12) ctx.lineTo(x, surface(x)); ctx.lineTo(x1, bot + 200); ctx.closePath(); };
      sandPath(); ctx.fillStyle = C.sand; ctx.fill();
      ctx.save(); sandPath(); ctx.clip();
      ctx.fillStyle = grain; ctx.fillRect(x0, top, x1 - x0, bot - top);
      ink(2, 'rgba(90, 60, 40, 0.18)');
      for (let d = 60; d < 700; d += 70) { ctx.beginPath(); for (let x = x0; x <= x1; x += 16) ctx.lineTo(x, surface(x) + d + Math.sin(x * 0.004 + d) * 12); ctx.stroke(); }
      for (const b of buried) {       // stones and bones, deep in the sand
        if (b.x < x0 - 60 || b.x > x1 + 60) continue;
        const y = surface(b.x) + b.d;
        ctx.save(); ctx.translate(b.x, y); ctx.rotate(b.rot);
        if (b.kind === 0) poly(ngon(0, 0, 22, 5, 0), 'rgba(90, 60, 40, 0.3)');
        else if (b.kind === 1) { ink(6, 'rgba(250, 240, 220, 0.6)'); ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(26, 0); ctx.stroke(); circle(-28, -5, 6, 'rgba(250,240,220,0.6)', false); circle(28, 5, 6, 'rgba(250,240,220,0.6)', false); }
        else { ink(3, 'rgba(90, 60, 40, 0.3)'); ctx.beginPath(); ctx.arc(0, 0, 18, 0, 7); ctx.stroke(); }
        ctx.restore();
      }
      for (const q of portals) if (q.to !== 'sky') drawPortal(q, frame, { lineColor: '#fff4dc' });
      // the wake: when you swim near the surface, the sand bulges above you
      if (p.s.under && p.y - surface(p.x) < 180) {
        const ax = p.x, ay = surface(ax);
        poly([[ax - 60, ay + 2], [ax - 20, ay - 12], [ax + 20, ay - 12], [ax + 60, ay + 2]], C.sand);
      }
      ctx.restore();
      ink(2, 'rgba(90, 60, 40, 0.35)'); ctx.beginPath(); for (let x = x0; x <= x1; x += 12) ctx.lineTo(x, surface(x)); ctx.stroke();
      // obelisks in a strict row, their shadows stretching and swinging with the sun
      const sunDX = Math.cos(arc), sunH = Math.max(0.12, Math.sin(arc));
      for (const o of obelisks) {
        if (o.x < x0 - 1200 || o.x > x1 + 1200) continue;
        const g = surface(o.x), len = Math.min(900, o.h / sunH * 0.5), dir = sunDX > 0 ? -1 : 1;
        ctx.fillStyle = 'rgba(60, 40, 40, 0.28)';
        ctx.beginPath(); ctx.moveTo(o.x - 20, g); ctx.lineTo(o.x + 20, g); ctx.lineTo(o.x + 20 + dir * len, g + 26); ctx.lineTo(o.x - 20 + dir * len, g + 26); ctx.closePath(); ctx.fill();
        poly([[o.x - 22, g + 6], [o.x + 22, g + 6], [o.x + 16, g - o.h], [o.x, g - o.h - 30], [o.x - 16, g - o.h]], C.dark ? '#1c1c2c' : '#2a2320');
      }
      drawPortal(portals.find((q) => q.to === 'sky'), frame, { lineColor: '#fff4dc' });
      // sand thrown up where you break the surface
      ctx.fillStyle = C.sand; for (const d of p.s.spray || []) ctx.fillRect(d.x - 4, d.y - 4, 8, 8);
    },
    avatar(p, frame) {
      // a banded serpent; only the parts above the sand are drawn
      const b = p.s.body; if (!b) return;
      const bands = ['#f4efe3', '#c9442a', '#262a4c'];
      ctx.save();
      ctx.beginPath(); ctx.moveTo(view.x - 20, view.y - 20); for (let x = view.x - 20; x <= view.x + view.w + 20; x += 12) ctx.lineTo(x, surface(x)); ctx.lineTo(view.x + view.w + 20, view.y - 20); ctx.closePath(); ctx.clip();
      for (let i = SEG - 1; i >= 0; i--) { const q = b[i * 4]; if (!q) continue; circle(q.x, q.y, 18 - i * 0.6, bands[i % 3], true, 1.4); }
      const hd = b[0], nx = b[3] || hd, a = Math.atan2(hd.y - nx.y, hd.x - nx.x);
      circle(hd.x + Math.cos(a) * 8 - Math.sin(a) * 6, hd.y + Math.sin(a) * 8 + Math.cos(a) * 6, 4, INK, false);
      if (frame % 3 === 0) { ink(2, '#c9442a'); ctx.beginPath(); ctx.moveTo(hd.x + Math.cos(a) * 18, hd.y + Math.sin(a) * 18); ctx.lineTo(hd.x + Math.cos(a) * 32, hd.y + Math.sin(a) * 32); ctx.stroke(); }
      ctx.restore();
    },
  };
})();

// =====================================================================
// 4. The Grandstand: a briefcase on legs, hopping one step at a time
// =====================================================================
const STAND = (() => {
  const W = 4400, H = 1900, STEP_W = 64, STEP_H = 30, BASE = 1600;
  const P = { wall: ['#d9d9d6', '#c6c6c2', '#b3b3ae', '#9f9f99', '#8b8b85'], cream: '#ece6d4', line: '#b9b2a0', green: '#2f8f4e', case: '#3b3b3b', yellow: '#f0d84a', red: '#c9332a', orange: '#f29a3a', ceil: '#e7e1cf' };
  const UP0 = 700, PEAK_X = UP0 + 34 * STEP_W, PEAK = BASE - 34 * STEP_H;
  const groundAt = (x) => {
    if (x < UP0) return BASE;
    if (x < PEAK_X) return BASE - (Math.floor((x - UP0) / STEP_W) + 1) * STEP_H;
    if (x < PEAK_X + 500) return PEAK;
    return Math.min(BASE, PEAK + (Math.floor((x - PEAK_X - 500) / STEP_W) + 1) * STEP_H);
  };
  const cases = [];
  for (let x = 740; x < W - 200; x += STEP_W) if (rand() < 0.4 && Math.abs(x - 4250) > 120) cases.push({ x: x + rr(8, 30) });
  const fogTex = stipple(P.yellow, ['#e8cc36', '#f7e57a', '#dcbc2c', '#fff0a0'], 1400, 96, 0.6, 1.6, 41);
  const portals = [
    { to: 'house', shape: 'rect', x: 420, y: BASE - 110, w: 70, h: 110, exit: { x: 560 }, door: P.red },
    { to: 'clock', shape: 'circle', x: PEAK_X + 250, y: PEAK - 70, r: 52, exit: { x: PEAK_X + 120 } },
    { to: 'dune', shape: 'rect', x: 4230, y: groundAt(4265) - 110, w: 70, h: 110, exit: { x: 4120 }, door: '#e9b67f' },
  ];
  return {
    id: 'stand', name: 'The Grandstand', swatch: ['#bdbdbd', '#2f8f4e', '#ece6d4'], bg: P.wall[0], viewH: 760,
    x0: 0, y0: 0, x1: W, y1: H, spawn: { x: 560 }, portals, groundAt,
    hint: 'You are a briefcase with legs. ← → hop one step; ↑ hops high.',
    place(p, spot) { p.x = Math.round(spot.x); p.y = groundAt(p.x); p.s.hop = null; },
    center: (p) => ({ x: p.x, y: p.y - 26 }),
    move(p, inp, dt) {
      const s = p.s;
      if (!s.hop) {
        let dir = inp.ix;
        if (p.target) { const dx = p.target.x - p.x; if (Math.abs(dx) < STEP_W / 2) p.target = null; else dir = Math.sign(dx); }
        if (dir) {
          const x1 = clamp(p.x + dir * STEP_W, 30, W - 30), y1 = groundAt(x1);
          s.hop = { x0: p.x, y0: p.y, x1, y1, t: 0, dur: 0.3, h: 36 + Math.max(0, p.y - y1) };
          p.face = dir;
        } else if (inp.upPressed || inp.iy < 0) s.hop = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, t: 0, dur: 0.55, h: 150 };
      }
      if (s.hop) {
        const h = s.hop; h.t += dt / h.dur;
        const u = Math.min(1, h.t);
        p.x = lerp(h.x0, h.x1, u); p.y = lerp(h.y0, h.y1, u) - Math.sin(Math.PI * u) * h.h;
        if (h.t >= 1) { p.x = h.x1; p.y = h.y1; s.hop = null; s.squash = 0.12; }
      }
      s.squash = Math.max(0, (s.squash || 0) - dt);
      p.vx = s.hop ? 100 : 0; p.vy = 0;
    },
    update() {},
    draw(t, frame) {
      const bh = 380;
      P.wall.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(view.x - 20, i === 0 ? -2000 : i * bh, view.w + 40, i === P.wall.length - 1 ? 4000 : bh + (i === 0 ? 2000 : 0)); });
      ink(1, 'rgba(60, 60, 60, 0.12)');
      for (let x = Math.floor(view.x / 14) * 14; x < view.x + view.w; x += 14) { ctx.beginPath(); ctx.moveTo(x, view.y); ctx.lineTo(x + 40, view.y + view.h); ctx.stroke(); }
      circle(par(3800, 0.4), 520, 90, P.orange, false);
      ctx.fillStyle = P.wall[1]; ctx.fillRect(par(3700, 0.4), 520, 400, 200);
      ctx.fillStyle = P.ceil; ctx.beginPath(); ctx.moveTo(600, 200); ctx.lineTo(W, 60); ctx.lineTo(W, 360); ctx.lineTo(600, 480); ctx.closePath(); ctx.fill();
      ctx.save(); ctx.clip(); ink(1, P.line); ctx.setLineDash([4, 6]);
      for (let x = 600; x < W; x += 120) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 60, 600); ctx.stroke(); }
      for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(600, 200 + k * 56); ctx.lineTo(W, 60 + k * 60); ctx.stroke(); }
      ctx.restore(); ctx.setLineDash([]);
      ctx.fillStyle = '#e9e9e4'; ctx.fillRect(160, 300, 26, BASE - 300);
      box(150, 260, 46, 110, '#2a2a2a', 1);
      circle(173, 285, 12, frame % 6 < 3 ? P.yellow : '#6b6a4a', false); circle(173, 315, 12, '#555', false); circle(173, 345, 12, frame % 6 >= 3 ? '#57c26a' : '#3d5b44', false);
      const x0 = Math.max(0, view.x - 40), x1 = view.x + view.w + 40;
      ctx.fillStyle = P.green;
      ctx.beginPath(); ctx.moveTo(UP0, BASE); ctx.lineTo(PEAK_X, PEAK - 120); ctx.lineTo(PEAK_X + 500, PEAK - 120); ctx.lineTo(PEAK_X + 500 + 34 * STEP_W, BASE); ctx.closePath(); ctx.fill();
      ctx.fillStyle = P.cream; ctx.beginPath(); ctx.moveTo(x0, H + 200);
      for (let x = x0; x <= x1; x += 4) ctx.lineTo(x, groundAt(x));
      ctx.lineTo(x1, H + 200); ctx.closePath(); ctx.fill();
      ink(1, P.line);
      for (let x = Math.floor(x0 / STEP_W) * STEP_W + UP0 % STEP_W; x < x1; x += STEP_W) { ctx.beginPath(); ctx.moveTo(x, groundAt(x + 1)); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = PEAK; y < BASE; y += STEP_H) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
      ink(1.4, INK); ctx.beginPath(); for (let x = x0; x <= x1; x += 4) ctx.lineTo(x, groundAt(x)); ctx.stroke();
      for (const c of cases) { if (!visible(c.x, 60)) continue; const g = groundAt(c.x + 12); box(c.x, g - 22, 30, 22, P.case, 1); ink(2, P.case); ctx.beginPath(); ctx.moveTo(c.x + 10, g - 22); ctx.lineTo(c.x + 10, g - 28); ctx.lineTo(c.x + 20, g - 28); ctx.lineTo(c.x + 20, g - 22); ctx.stroke(); }
      ink(2.5, P.green);
      ctx.beginPath(); ctx.moveTo(PEAK_X + 330, PEAK - 50); ctx.lineTo(PEAK_X + 460, PEAK - 50); for (let x = PEAK_X + 330; x <= PEAK_X + 460; x += 65) { ctx.moveTo(x, PEAK - 50); ctx.lineTo(x, PEAK); } ctx.stroke();
      // the landing clock on a post
      const c = portals[1]; ctx.fillStyle = '#e9e9e4'; ctx.fillRect(c.x - 4, c.y, 8, PEAK - c.y);
      for (const q of portals) {
        if (q.door) { ctx.fillStyle = q.door; ctx.fillRect(q.x - 10, q.y - 10, q.w + 20, 10); ctx.fillRect(q.x - 10, q.y, 10, q.h); ctx.fillRect(q.x + q.w, q.y, 10, q.h); }
        drawPortal(q, frame, { labelAbove: true, lineColor: INK });
      }
      ink(6, '#e9e9e4'); ctx.beginPath(); ctx.arc(c.x, c.y, c.r + 3, 0, 7); ctx.stroke();
      ctx.fillStyle = fogTex; ctx.beginPath(); ctx.moveTo(view.x - 20, H + 100);
      for (let x = view.x - 20; x < view.x + view.w + 40; x += 30) ctx.lineTo(x, BASE + 30 + Math.sin(x * 0.02 + (frame % 2)) * 8);
      ctx.lineTo(view.x + view.w + 40, H + 100); ctx.closePath(); ctx.fill();
    },
    avatar(p) {
      // a briefcase on two thin legs; it crouches before each hop and squashes on landing
      const s = p.s, air = !!s.hop, sq = s.squash > 0 ? 0.8 : 1;
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(p.face, 1);
      const legs = air ? 16 : 12 * sq;
      ink(2.6); ctx.beginPath(); ctx.moveTo(-8, -legs); ctx.lineTo(air ? -12 : -9, 0); ctx.moveTo(8, -legs); ctx.lineTo(air ? 12 : 9, 0); ctx.stroke();
      const bh = 30 * sq, top = -legs - bh;
      box(-22, top, 44, bh, '#3b3b3b', 1.4);
      ink(2.6, '#3b3b3b'); ctx.beginPath(); ctx.moveTo(-8, top); ctx.lineTo(-8, top - 8); ctx.lineTo(8, top - 8); ctx.lineTo(8, top); ctx.stroke();
      ctx.fillStyle = '#d9b44a'; ctx.fillRect(-14, top + 6, 5, 4); ctx.fillRect(9, top + 6, 5, 4);
      circle(12, top + bh * 0.62, 3.2, '#ffffff', false); circle(13, top + bh * 0.62, 1.6, INK, false);
      ctx.restore();
    },
  };
})();

// =====================================================================
// 5. The Hour: a little alarm clock circling a great clock face.
//    ← → spin around the centre, ↑ ↓ move out and in. Time runs slow at the
//    centre and fast at the rim, and your recent past follows you as echoes.
// =====================================================================
const CLOCK = (() => {
  const R = 900;
  const P = { rings: ['#1f3b5c', '#244466', '#2a4d72', '#30567e'], face: '#f1e8d2', red: '#e2552d', yellow: '#e8c547', ink: INK };
  const minis = Array.from({ length: 12 }, (_, i) => ({ a: (i / 12) * Math.PI * 2, r: 1320 + (i % 2) * 140, speed: (i % 3 + 1) * 0.04 * (i % 2 ? 1 : -1), rate: rr(0.3, 3) }));
  const dials = [[-Math.PI / 2, 'house'], [0, 'stand'], [Math.PI / 2, 'mirror'], [Math.PI, 'shapes']];
  const portals = dials.map(([a, to]) => ({ to, shape: 'circle', x: Math.cos(a) * 560, y: Math.sin(a) * 560, r: 72, exit: { a, r: 380 } }));
  let wt = 0;   // this world's own time, which runs at different speeds in different places
  return {
    id: 'clock', name: 'The Hour', swatch: ['#244466', '#f1e8d2', '#e2552d'], bg: P.rings[0], viewH: 3000, fixed: { x: 0, y: 0 },
    x0: -2000, y0: -2000, x1: 2000, y1: 2000, spawn: { a: -Math.PI / 2, r: 380 }, portals,
    hint: 'You are an alarm clock. ← → circle the face, ↑ ↓ move out and in. Time runs slow at the centre.',
    place(p, spot) { p.s.a = spot.a; p.s.r = spot.r; p.s.va = 0; p.s.vr = 0; p.s.hist = []; p.x = Math.cos(spot.a) * spot.r; p.y = Math.sin(spot.a) * spot.r; },
    move(p, inp, dt) {
      const s = p.s;
      let ix = inp.ix, iy = inp.iy;
      if (p.target) {
        const ta = Math.atan2(p.target.y, p.target.x), tr = Math.hypot(p.target.x, p.target.y);
        const da = wrapAngle(ta - s.a);
        ix = clamp(da * 3, -1, 1); iy = clamp(-(tr - s.r) / 80, -1, 1);
        if (Math.abs(da) < 0.03 && Math.abs(tr - s.r) < 20) p.target = null;
      }
      s.va = lerp(s.va, ix * 1.1, ease(5, dt));
      s.vr = lerp(s.vr, -iy * 420, ease(6, dt));
      s.a += s.va * dt; s.r = clamp(s.r + s.vr * dt, 110, 1200);
      const nx = Math.cos(s.a) * s.r, ny = Math.sin(s.a) * s.r;
      p.vx = (nx - p.x) / Math.max(dt, 1e-4); p.vy = (ny - p.y) / Math.max(dt, 1e-4);
      p.x = nx; p.y = ny;
      p.face = s.va >= 0 ? 1 : -1;
      s.hist.push({ x: p.x, y: p.y }); if (s.hist.length > 400) s.hist.shift();
    },
    update(dt, t, frame, p) {
      const r = p.s && p.s.r !== undefined ? p.s.r : 600;
      this.rate = 0.25 + 2.2 * clamp(r / 1100, 0, 1) ** 2;
      wt += dt * this.rate;
      for (const m of minis) m.a += m.speed * dt * this.rate;
    },
    draw(t, frame, st, p) {
      for (let r = 3000, k = 0; r > R; r -= 160, k++) circle(0, 0, r, P.rings[k % P.rings.length], false);
      // orbiting little clocks, each keeping a different time
      for (const m of minis) {
        const x = Math.cos(m.a) * m.r, y = Math.sin(m.a) * m.r;
        circle(x, y, 86, P.face, true, 5);
        for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283; ctx.fillStyle = INK; ctx.fillRect(x + Math.cos(a) * 70 - 3, y + Math.sin(a) * 70 - 3, 6, 6); }
        ink(8); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(wt * m.rate * 0.1) * 40, y + Math.sin(wt * m.rate * 0.1) * 40); ctx.stroke();
        ink(5, P.red); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(wt * m.rate) * 66, y + Math.sin(wt * m.rate) * 66); ctx.stroke();
      }
      // the great face
      circle(0, 0, R, P.face, true, 10);
      ink(3); ctx.beginPath(); ctx.arc(0, 0, R - 70, 0, 7); ctx.stroke();
      for (let i = 0; i < 60; i++) { const a = (i / 60) * 6.283, l = i % 5 ? 20 : 48; ink(i % 5 ? 4 : 9); ctx.beginPath(); ctx.moveTo(Math.cos(a) * (R - 16), Math.sin(a) * (R - 16)); ctx.lineTo(Math.cos(a) * (R - 16 - l), Math.sin(a) * (R - 16 - l)); ctx.stroke(); }
      ctx.fillStyle = INK; ctx.font = '500 92px Jost, Futura, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let n = 1; n <= 12; n++) { if (n % 3 === 0) continue; const a = (n / 12) * 6.283 - Math.PI / 2; ctx.fillText(String(n), Math.cos(a) * 740, Math.sin(a) * 740); }
      // the hands: the second hand ticks in jumps
      const hand = (a, len, w, color) => { ink(w, color); ctx.beginPath(); ctx.moveTo(-Math.cos(a) * len * 0.15, -Math.sin(a) * len * 0.15); ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len); ctx.stroke(); };
      hand(wt * 0.02 - Math.PI / 2, 430, 30, INK);
      hand(wt * 0.24 - Math.PI / 2, 660, 16, INK);
      hand(Math.floor(wt) * (6.283 / 60) - Math.PI / 2, 800, 6, P.red);
      circle(0, 0, 34, P.red, false);
      for (const q of portals) drawPortal(q, frame, { lineColor: INK });
      // echoes of where you were
      const h = p.s.hist || [];
      for (let k = 6; k >= 1; k--) {
        const e = h[h.length - 1 - k * 18]; if (!e) continue;
        ctx.globalAlpha = 0.5 - k * 0.06;
        circle(e.x, e.y, 80, P.yellow, false);
        ctx.globalAlpha = 1;
      }
    },
    avatar(p, frame) {
      // an alarm clock with bells and legs; its hand spins at this spot's speed of time
      const s = p.s, up = s.a + Math.PI / 2;   // stand upright relative to the centre
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(up); ctx.scale(2.2, 2.2);
      const ring = frame % 2 ? 3 : -3;
      circle(-24 + ring * 0.5, -34, 13, P.yellow); circle(24 - ring * 0.5, -34, 13, P.yellow);
      ink(4); ctx.beginPath(); ctx.moveTo(-18, 30); ctx.lineTo(-26, 50); ctx.moveTo(18, 30); ctx.lineTo(26, 50); ctx.stroke();
      circle(0, 0, 40, P.red, true, 3);
      circle(0, 0, 30, P.face, false);
      const ha = (t * (this.rate || 1) * 4);
      ink(4); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ha) * 22, Math.sin(ha) * 22); ctx.stroke();
      ink(5); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -14); ctx.stroke();
      ctx.restore();
    },
  };
})();

// =====================================================================
// 6. The Shapes: a polygon that tumbles corner over corner.
//    ↑ adds a corner, ↓ takes one away; a circle rolls smoothly.
// =====================================================================
const SHAPES = (() => {
  const W = 6600, G = 1000, RC = 56;
  const SIDES = [3, 4, 5, 6, 8, 24];
  const COLORS = { 3: '#f2c230', 4: '#2e62b0', 5: '#e2552d', 6: '#2f8f4e', 8: '#2a2a2a', 24: '#e8a3b8' };
  const P = { bg: '#efe7d3', ground: '#dcd4c2', red: '#e2552d', blue: '#2e62b0', yellow: '#f2c230', black: '#1e1e1e', green: '#2f8f4e' };
  const far = [], near = [];
  for (let x = -600; x < W; x += rr(420, 700)) far.push({ x, kind: pick(['circle', 'square', 'tri', 'half', 'bars', 'dots']), s: rr(180, 340), c: pick([P.red, P.blue, P.yellow, P.black]), y: rr(250, 650) });
  for (let x = 300; x < W; x += rr(300, 520)) near.push({ x, kind: pick(['stack', 'arch', 'totem', 'ring']), s: rr(50, 90) });
  const door = (to, shape, x, size) => {
    if (shape === 'circle') return { to, shape, x, y: G - size, r: size, exit: { x: x + size + 160 } };
    if (shape === 'tri') return { to, shape, x: x - size, y: G - size * 2, w: size * 2, h: size * 2, exit: { x: x + size + 160 } };
    if (shape === 'ngon') return { to, shape, x, y: G - size, r: size, n: 5, exit: { x: x + size + 160 } };
    return { to, shape: 'rect', x: x - size, y: G - size * 2, w: size * 2, h: size * 2, exit: { x: x + size + 160 } };
  };
  const portals = [door('house', 'rect', 900, 110), door('dune', 'tri', 2500, 130), door('orbit', 'circle', 4100, 125), door('clock', 'ngon', 5700, 125)];
  const geom = (n) => { const s = 2 * RC * Math.sin(Math.PI / n), a = RC * Math.cos(Math.PI / n); return { s, a }; };
  // where the shape is and how it's turned, part-way through a roll
  function pose(st) {
    const { s, a } = geom(st.n);
    if (!st.roll) return { x: st.cx, y: G - a, rot: st.rot };
    const d = st.dir, alpha = d * st.roll * (2 * Math.PI / st.n);
    const px = st.cx + d * s / 2, py = G;
    const vx = st.cx - px, vy = -a;
    return { x: px + vx * Math.cos(alpha) - vy * Math.sin(alpha), y: py + vx * Math.sin(alpha) + vy * Math.cos(alpha), rot: st.rot + alpha };
  }
  return {
    id: 'shapes', name: 'The Shapes', swatch: ['#efe7d3', '#e2552d', '#2e62b0'], bg: P.bg, viewH: 900,
    x0: 0, y0: 0, x1: W, y1: 1500, spawn: { x: 700 }, portals,
    hint: 'You are a shape. ← → tumble. ↑ adds a corner, ↓ takes one away.',
    place(p, spot) { Object.assign(p.s, { n: p.s.n || 4, cx: spot.x, rot: 0, roll: 0, dir: 1, queued: 0 }); const q = pose(p.s); p.x = q.x; p.y = q.y; },
    move(p, inp, dt) {
      const st = p.s;
      if (inp.upPressed) st.queued = 1;
      if (inp.downPressed) st.queued = -1;
      let ix = inp.ix;
      if (p.target) { const dx = p.target.x - st.cx; if (Math.abs(dx) < geom(st.n).s * 0.6) p.target = null; else ix = Math.sign(dx); }
      if (!st.roll) {
        if (st.queued) { const i = clamp(SIDES.indexOf(st.n) + st.queued, 0, SIDES.length - 1); st.n = SIDES[i]; st.rot = 0; st.queued = 0; }
        if (ix) { st.dir = ix; st.roll = 1e-6; p.face = ix; }
      }
      if (st.roll) {
        const { s } = geom(st.n);
        st.roll += dt * (st.n >= 24 ? 280 / s : 2.6);
        if (st.roll >= 1) {
          st.cx = clamp(st.cx + st.dir * s, 150, W - 150); st.rot += st.dir * (2 * Math.PI / st.n); st.roll = 0;
          st.landed = 0.12;
        }
      }
      st.landed = Math.max(0, (st.landed || 0) - dt);
      const q = pose(st);
      p.vx = st.roll ? 100 : 0; p.vy = 0; p.x = q.x; p.y = q.y;
    },
    update() {},
    draw(t, frame) {
      ctx.fillStyle = P.bg; ctx.fillRect(view.x - 20, view.y - 20, view.w + 40, view.h + 40);
      for (const f of far) {
        const x = par(f.x, 0.3), y = f.y, s = f.s;
        if (x < view.x - 500 || x > view.x + view.w + 500) continue;
        ctx.fillStyle = f.c;
        if (f.kind === 'circle') { ctx.beginPath(); ctx.arc(x, y, s * 0.5, 0, 7); ctx.fill(); }
        else if (f.kind === 'square') ctx.fillRect(x - s / 2, y - s / 2, s, s);
        else if (f.kind === 'tri') poly([[x, y - s / 2], [x + s / 2, y + s / 2], [x - s / 2, y + s / 2]], f.c);
        else if (f.kind === 'half') { ctx.beginPath(); ctx.arc(x, y, s * 0.5, Math.PI, 0); ctx.fill(); }
        else if (f.kind === 'bars') for (let k = 0; k < 6; k++) ctx.fillRect(x - s / 2 + k * s / 6, y - s / 2, s / 12, s);
        else for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) { ctx.beginPath(); ctx.arc(x - s / 2 + i * s / 4, y - s / 2 + j * s / 4, s / 22, 0, 7); ctx.fill(); }
      }
      ctx.fillStyle = P.ground; ctx.fillRect(view.x - 20, G, view.w + 40, 2000);
      ink(1, '#c6bda8'); for (let y = G + 30; y < view.y + view.h; y += 30) { ctx.beginPath(); ctx.moveTo(view.x - 20, y); ctx.lineTo(view.x + view.w + 20, y); ctx.stroke(); }
      for (const n of near) {
        if (!visible(n.x)) continue;
        const x = n.x, s = n.s;
        if (n.kind === 'stack') { ctx.fillStyle = P.blue; ctx.fillRect(x - s / 2, G - s, s, s); circle(x, G - s * 1.5, s / 2, P.red, false); poly([[x, G - s * 2.6], [x + s / 2, G - s * 2], [x - s / 2, G - s * 2]], P.yellow); }
        else if (n.kind === 'arch') { ink(s * 0.35, P.black); ctx.lineCap = 'butt'; ctx.beginPath(); ctx.arc(x, G, s, Math.PI, 0); ctx.stroke(); }
        else if (n.kind === 'totem') { for (let k = 0; k < 4; k++) { ctx.fillStyle = [P.red, P.yellow, P.blue, P.green][k]; ctx.fillRect(x - s * 0.3, G - (k + 1) * s * 0.55, s * 0.6, s * 0.5); } }
        else { ink(12, P.yellow); ctx.beginPath(); ctx.arc(x, G - s, s * 0.9, 0, 7); ctx.stroke(); }
      }
      ink(4, P.black); ctx.beginPath(); ctx.moveTo(view.x - 20, G); ctx.lineTo(view.x + view.w + 20, G); ctx.stroke();
      for (const q of portals) {
        // a shaped doorway cut into a black slab
        const bx = portalBox(q);
        ctx.fillStyle = P.black; ctx.fillRect(bx.x - 34, bx.y - 34, bx.w + 68, G - bx.y + 34);
        drawPortal(q, frame, { labelAbove: false });
      }
    },
    avatar(p, frame) {
      const st = p.s, q = pose(st);
      const col = COLORS[st.n];
      ctx.fillStyle = col; ctx.beginPath();
      for (let i = 0; i < st.n; i++) { const a = q.rot + Math.PI / 2 + Math.PI / st.n + (i / st.n) * 6.283; ctx.lineTo(q.x + Math.cos(a) * RC, q.y + Math.sin(a) * RC); }
      ctx.closePath(); ctx.fill(); ink(2); ctx.stroke();
      // the eye stays upright and looks where it's going
      const blink = frame % 17 === 0;
      circle(q.x + p.face * 10, q.y - 10, 14, '#ffffff', true, 1.5);
      if (!blink) circle(q.x + p.face * 15, q.y - 10, 6, INK, false);
      else { ink(2); ctx.beginPath(); ctx.moveTo(q.x + p.face * 10 - 10, q.y - 10); ctx.lineTo(q.x + p.face * 10 + 10, q.y - 10); ctx.stroke(); }
    },
  };
})();

// =====================================================================
// 7. The Orbits: a small moon falling around planets under gravity.
//    Arrows fire small thrusts; the dotted trail draws your orbit.
// =====================================================================
const ORBIT = (() => {
  const P = { space: '#0f1026', star: '#dcd6ff', sun: '#f2c230', trail: '#f1e8d2' };
  const sun = { x: 0, y: 0, r: 200, gm: 3.2e7 };
  const planets = [
    { R: 1000, w: 0.05, ph: 0.4, r: 70, gm: 3e6, color: '#e2552d', ring: true, to: 'night' },
    { R: 1700, w: -0.03, ph: 2.2, r: 110, gm: 6e6, color: '#2e62b0', bands: true, to: 'shapes' },
    { R: 2500, w: 0.02, ph: 4.1, r: 64, gm: 2e6, color: '#8fcaa6', dots: true, to: 'mirror' },
  ];
  for (const pl of planets) { pl.x = Math.cos(pl.ph) * pl.R; pl.y = Math.sin(pl.ph) * pl.R; }
  const stars = Array.from({ length: 500 }, () => ({ x: rr(-4000, 4000), y: rr(-4000, 4000), s: rr(1, 2.6) }));
  const belt = Array.from({ length: 160 }, () => ({ a: rr(0, 6.283), R: rr(2050, 2200), s: rr(3, 8) }));
  const portals = planets.map((pl) => ({ to: pl.to, shape: 'circle', x: pl.x, y: pl.y, r: pl.r * 1.9, planet: pl }));
  const bodies = [sun, ...planets];
  let wt = 0;
  return {
    id: 'orbit', name: 'The Orbits', swatch: ['#0f1026', '#f2c230', '#e2552d'], bg: P.space, viewH: 2200,
    x0: -3600, y0: -3600, x1: 3600, y1: 3600, spawn: { x: 0, y: -620, vx: 230, vy: 0 }, portals,
    hint: 'You are a small moon. Arrows fire little thrusts; gravity does the rest.',
    place(p, spot) {
      if (spot.planet) { const pl = spot.planet; const a = Math.atan2(pl.y, pl.x); p.x = pl.x + Math.cos(a) * pl.r * 3.2; p.y = pl.y + Math.sin(a) * pl.r * 3.2; const v = Math.sqrt(sun.gm / Math.hypot(p.x, p.y)); p.vx = -Math.sin(a) * v; p.vy = Math.cos(a) * v; }
      else { p.x = spot.x; p.y = spot.y; p.vx = spot.vx; p.vy = spot.vy; }
      p.s.trail = []; p.s.tick = 0;
    },
    arriveSpot(from) { const q = portals.find((x) => x.to === from); return q ? { planet: q.planet } : null; },
    move(p, inp, dt) {
      let { ix, iy } = inp;
      const a = aimAt(p, 40); if (a) ({ ix, iy } = a);
      const l = Math.hypot(ix, iy); if (l > 1) { ix /= l; iy /= l; }
      let ax = ix * 240, ay = iy * 240;
      p.s.thrust = l > 0;
      for (const b of bodies) {
        const dx = b.x - p.x, dy = b.y - p.y, d2 = Math.max(dx * dx + dy * dy, (b.r + 20) ** 2), d = Math.sqrt(d2);
        ax += b.gm * dx / (d2 * d); ay += b.gm * dy / (d2 * d);
      }
      const r0 = Math.hypot(p.x, p.y);
      if (r0 > 3300) { ax -= p.x / r0 * 200; ay -= p.y / r0 * 200; }
      p.vx += ax * dt; p.vy += ay * dt;
      const sp = Math.hypot(p.vx, p.vy); if (sp > 900) { p.vx *= 900 / sp; p.vy *= 900 / sp; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      for (const b of bodies) {   // bump softly off surfaces
        const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy), min = b.r + 20;
        if (d < min) { const nx = dx / d, ny = dy / d; p.x = b.x + nx * min; p.y = b.y + ny * min; const vn = p.vx * nx + p.vy * ny; if (vn < 0) { p.vx -= 1.5 * vn * nx; p.vy -= 1.5 * vn * ny; } }
      }
      if (Math.abs(p.vx) > 20) p.face = Math.sign(p.vx);
      p.s.tick += dt;
      if (p.s.tick > 0.05) { p.s.tick = 0; p.s.trail.push({ x: p.x, y: p.y }); if (p.s.trail.length > 260) p.s.trail.shift(); }
    },
    update(dt) {
      wt += dt;
      for (const pl of planets) { pl.x = Math.cos(pl.ph + wt * pl.w) * pl.R; pl.y = Math.sin(pl.ph + wt * pl.w) * pl.R; }
      portals.forEach((q, i) => { q.x = planets[i].x; q.y = planets[i].y; });
    },
    draw(t, frame, st, p) {
      ctx.fillStyle = P.space; ctx.fillRect(view.x - 20, view.y - 20, view.w + 40, view.h + 40);
      ctx.fillStyle = P.star;
      for (const s of stars) { const x = par(s.x, 0.4), y = s.y + view.y * 0.6; ctx.fillRect(x, y, s.s * 2, s.s * 2); }
      ink(2, 'rgba(241, 232, 210, 0.18)'); ctx.setLineDash([10, 16]);
      for (const pl of planets) { ctx.beginPath(); ctx.arc(0, 0, pl.R, 0, 7); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.fillStyle = '#6b6680';
      for (const b of belt) { const a = b.a + wt * 0.01; ctx.fillRect(Math.cos(a) * b.R, Math.sin(a) * b.R, b.s, b.s); }
      // the sun, with rays that flip between two drawings
      ctx.fillStyle = P.sun;
      for (let i = 0; i < 16; i++) { const a = (i / 16) * 6.283 + (frame % 2) * 0.1; poly([[Math.cos(a - 0.08) * 220, Math.sin(a - 0.08) * 220], [Math.cos(a) * 330, Math.sin(a) * 330], [Math.cos(a + 0.08) * 220, Math.sin(a + 0.08) * 220]], P.sun); }
      circle(0, 0, sun.r, P.sun, false);
      circle(-50, -40, 22, '#e3a33a', false); circle(40, 50, 14, '#e3a33a', false);
      for (const q of portals) drawPortal(q, frame);
      for (const pl of planets) {
        circle(pl.x, pl.y, pl.r, pl.color, false);
        if (pl.bands) { ctx.save(); ctx.beginPath(); ctx.arc(pl.x, pl.y, pl.r, 0, 7); ctx.clip(); ctx.fillStyle = '#9fc0e8'; for (let k = -3; k <= 3; k++) ctx.fillRect(pl.x - pl.r, pl.y + k * 30, pl.r * 2, 10); ctx.restore(); }
        if (pl.dots) for (let k = 0; k < 6; k++) circle(pl.x + Math.cos(k) * pl.r * 0.5, pl.y + Math.sin(k * 1.7) * pl.r * 0.5, 7, '#2f8f4e', false);
        if (pl.ring) { ink(8, '#f1e8d2'); ctx.beginPath(); ctx.ellipse(pl.x, pl.y, pl.r * 1.7, pl.r * 0.35, -0.3, 0, 7); ctx.stroke(); }
      }
      // your orbit, drawn as a dotted trail
      ctx.fillStyle = P.trail;
      const tr = p.s.trail || [];
      tr.forEach((d, i) => { if (i % 2) return; const r = 4 + (i / tr.length) * 8; ctx.fillRect(d.x - r / 2, d.y - r / 2, r, r); });
    },
    avatar(p, frame) {
      if (p.s.thrust) { const a = Math.atan2(-p.vy, -p.vx); for (let k = 0; k < 3; k++) circle(p.x + Math.cos(a) * (60 + k * 24), p.y + Math.sin(a) * (60 + k * 24), ((frame % 2 ? 7 : 5) - k * 1.5) * 2, '#ffd66b', false); }
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(2, 2);
      circle(0, 0, 24, '#f1e8d2', true, 2);
      circle(-8, 8, 5, '#d9cba6', false); circle(9, 12, 3.5, '#d9cba6', false);
      circle(-7 + p.face * 3, -5, 3, INK, false); circle(7 + p.face * 3, -5, 3, INK, false);
      ctx.restore();
    },
  };
})();

// =====================================================================
// 8. The Mirror: a spark you steer like a comet. ← → turn, ↑ speeds up,
//    ↓ slows. Its trail is repeated twelve ways, like a kaleidoscope.
// =====================================================================
const MIRROR = (() => {
  const ARENA = 1300;
  const INKS = ['#ff5fa2', '#3d7bff', '#ffd23f', '#3fe0a1', '#ff7a3d'];
  const trail = [];
  const portals = [
    { to: 'clock', shape: 'ngon', n: 3, x: Math.cos(-Math.PI / 2) * 900, y: Math.sin(-Math.PI / 2) * 900, r: 110, exitA: -Math.PI / 2 },
    { to: 'night', shape: 'ngon', n: 4, x: Math.cos(Math.PI / 6) * 900, y: Math.sin(Math.PI / 6) * 900, r: 110, exitA: Math.PI / 6 },
    { to: 'orbit', shape: 'ngon', n: 6, x: Math.cos(Math.PI * 5 / 6) * 900, y: Math.sin(Math.PI * 5 / 6) * 900, r: 110, exitA: Math.PI * 5 / 6 },
  ];
  for (const q of portals) q.exit = { x: Math.cos(q.exitA) * 640, y: Math.sin(q.exitA) * 640, h: q.exitA + Math.PI };
  let tick = 0;
  return {
    id: 'mirror', name: 'The Mirror', swatch: ['#15131a', '#ff5fa2', '#3d7bff'], bg: '#15131a', viewH: 3000, fixed: { x: 0, y: 0 },
    x0: -2000, y0: -2000, x1: 2000, y1: 2000, spawn: { x: 0, y: 200, h: -Math.PI / 2 }, portals,
    hint: 'You are a spark. ← → turn, ↑ faster, ↓ slower. Everything you draw is mirrored.',
    place(p, spot) { p.x = spot.x; p.y = spot.y; p.s.h = spot.h ?? 0; p.s.v = 220; trail.length = 0; },
    move(p, inp, dt) {
      const s = p.s;
      let turn = inp.ix, thrust = -inp.iy;
      if (p.target) {
        const ta = Math.atan2(p.target.y - p.y, p.target.x - p.x), da = wrapAngle(ta - s.h);
        turn = clamp(da * 2, -1, 1); thrust = 0.3;
        if (Math.hypot(p.target.x - p.x, p.target.y - p.y) < 60) p.target = null;
      }
      s.h += turn * 2.8 * dt;
      s.v = clamp(s.v + thrust * 500 * dt + (220 - s.v) * 0.6 * dt, 90, 760);
      p.vx = Math.cos(s.h) * s.v; p.vy = Math.sin(s.h) * s.v;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const r = Math.hypot(p.x, p.y);
      if (r > ARENA) {   // bounce off the rim of the kaleidoscope
        const nx = p.x / r, ny = p.y / r;
        p.x = nx * ARENA; p.y = ny * ARENA;
        const vn = p.vx * nx + p.vy * ny; p.vx -= 2 * vn * nx; p.vy -= 2 * vn * ny;
        s.h = Math.atan2(p.vy, p.vx);
      }
      p.face = p.vx >= 0 ? 1 : -1;
      tick += dt;
      if (tick > 0.016) { tick = 0; trail.push({ x: p.x, y: p.y, c: INKS[Math.floor(t / 1.6) % INKS.length] }); if (trail.length > 1400) trail.shift(); }
    },
    update() {},
    draw(tt, frame) {
      ctx.fillStyle = '#15131a'; ctx.fillRect(view.x - 20, view.y - 20, view.w + 40, view.h + 40);
      ink(3, 'rgba(244, 239, 227, 0.25)'); ctx.setLineDash([14, 18]);
      ctx.beginPath(); ctx.arc(0, 0, ARENA + 40, 0, 7); ctx.stroke();
      for (let k = 0; k < 6; k++) { const a = (k / 6) * 6.283; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * ARENA, Math.sin(a) * ARENA); ctx.stroke(); }
      ctx.setLineDash([]);
      // the trail, mirrored twelve ways
      for (let k = 0; k < 6; k++) for (const flip of [1, -1]) {
        ctx.save(); ctx.rotate((k / 6) * 6.283); ctx.scale(1, flip);
        let i = 0;
        while (i < trail.length - 1) {
          const c = trail[i].c;
          ctx.strokeStyle = c; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath(); ctx.moveTo(trail[i].x, trail[i].y);
          while (i < trail.length - 1 && trail[i + 1].c === c) { i++; ctx.lineTo(trail[i].x, trail[i].y); }
          if (i < trail.length - 1) { ctx.lineTo(trail[i + 1].x, trail[i + 1].y); i++; }
          ctx.stroke();
        }
        ctx.restore();
      }
      for (const q of portals) {
        q.spin = frame * 0.05;
        drawPortal(q, frame, { lineColor: '#f4efe3' });
      }
    },
    avatar(p, frame) {
      // the spark and its eleven reflections
      for (let k = 0; k < 6; k++) for (const flip of [1, -1]) {
        if (k === 0 && flip === 1) continue;
        ctx.save(); ctx.rotate((k / 6) * 6.283); ctx.scale(1, flip);
        circle(p.x, p.y, 26, 'rgba(244, 239, 227, 0.35)', false);
        ctx.restore();
      }
      const r = frame % 2 ? 64 : 50;
      ctx.fillStyle = '#f4efe3'; ctx.beginPath();
      for (let i = 0; i < 16; i++) { const a = (i / 16) * 6.283 + frame * 0.3, rad = i % 2 ? r * 0.35 : r; ctx.lineTo(p.x + Math.cos(a) * rad, p.y + Math.sin(a) * rad); }
      ctx.closePath(); ctx.fill();
      circle(p.x, p.y, 22, '#ffd23f', false);
    },
  };
})();

// =====================================================================
// 9. The Sky: a small bird. ↑ flaps, ← → steer, let go to glide, ↓ dives.
//    Columns of warm air lift you.
// =====================================================================
const SKY = (() => {
  const W = 7000, H = 3200, GROUND = 3000;
  const P = { bands: ['#8fb9e2', '#a0c4e7', '#b2cfeb', '#c6dcef', '#e6dde0', '#f3d2bd'], roof: ['#7d8fa6', '#6b7c93', '#8a9bb0', '#5f6f86'], sun: '#fff1c1', red: '#e2552d', yellow: '#e8c547', cream: '#f4efe3' };
  const cloudTex = stipple('#ffffff', ['#eef3f8', '#dfe8f1', '#ffffff', '#f7f7f7'], 900, 96, 0.5, 1.4, 61);
  const mkCloud = (x, y, s) => ({ x, y, parts: Array.from({ length: 6 }, (_, k) => ({ dx: (k - 2.5) * 70 * s + rr(-20, 20), dy: rr(-30, 20) * s, rx: rr(70, 120) * s, ry: rr(36, 60) * s })) });
  const backClouds = Array.from({ length: 22 }, () => mkCloud(rr(0, W), rr(300, 2600), rr(0.8, 1.6)));
  const frontClouds = Array.from({ length: 7 }, () => mkCloud(rr(0, W), rr(500, 2500), rr(1.2, 2)));
  const thermals = [900, 2100, 3300, 4600, 5800].map((x) => ({ x, w: 240 }));
  const flocks = Array.from({ length: 4 }, (_, i) => ({ x: rr(0, W), y: rr(400, 2200), v: rr(60, 120) * (i % 2 ? 1 : -1), n: 5 + i * 2 }));
  const houses = []; for (let x = -100; x < W + 200; x += rr(160, 280)) houses.push({ x, w: rr(120, 240), h: rr(90, 220), c: pick(P.roof), roof: pick(['gable', 'flat', 'dome']) });
  const kites = [1500, 3900, 5200].map((x, i) => ({ x, y: rr(1700, 2200), c: [P.red, P.yellow, '#2e62b0'][i] }));
  const balloon = { x: 2800, y: 1300 };
  const portals = [
    { to: 'house', shape: 'rect', x: 560, y: 1440, w: 110, h: 140, exit: { x: 780, y: 1510 } },
    { to: 'night', shape: 'circle', x: 3500, y: 300, r: 95, exit: { x: 3500, y: 540 } },
    { to: 'dune', shape: 'rect', x: 6360, y: GROUND - 130, w: 76, h: 130, exit: { x: 6200, y: GROUND - 140 } },
  ];
  const drawCloud = (c) => { ctx.fillStyle = cloudTex; ctx.beginPath(); for (const q of c.parts) { ctx.moveTo(c.x + q.dx + q.rx, c.y + q.dy); ctx.ellipse(c.x + q.dx, c.y + q.dy, q.rx, q.ry, 0, 0, 7); } ctx.fill(); };
  const inThermal = (x) => thermals.some((th) => Math.abs(x - th.x) < th.w / 2);
  return {
    id: 'sky', name: 'The Sky', swatch: ['#a0c4e7', '#ffffff', '#e2552d'], bg: P.bands[0], viewH: 1000,
    x0: 0, y0: 0, x1: W, y1: H, spawn: { x: 780, y: 1510 }, portals,
    hint: 'You are a bird. ↑ flaps, ← → steer, let go to glide, ↓ dives. Warm air lifts you.',
    place(p, spot) { p.x = spot.x; p.y = spot.y; p.vx = 60; p.vy = 0; p.s.flapT = 0; p.s.wing = 0; },
    move(p, inp, dt) {
      const s = p.s;
      let ix = inp.ix, up = inp.upPressed || (inp.iy < 0 && s.flapT <= 0), dive = inp.iy > 0;
      if (p.target) {
        const dx = p.target.x - p.x, dy = p.target.y - p.y;
        if (Math.hypot(dx, dy) < 40) p.target = null;
        else { ix = Math.sign(dx) * (Math.abs(dx) > 20 ? 1 : 0); up = up || (dy < -20 && s.flapT <= 0 && p.vy > -120); dive = dy > 200; }
      }
      s.flapT -= dt; s.wing = Math.max(0, s.wing - dt);
      if (up) { p.vy = Math.min(p.vy, 60) - 430; p.vx += p.face * 90; s.flapT = 0.26; s.wing = 0.22; s.perched = false; }
      if (ix) { p.face = ix; p.vx += ix * 520 * dt; }
      p.vx *= Math.exp(-0.5 * dt);
      p.vx = clamp(p.vx, -560, 560);
      p.vy += (dive ? 1500 : 760) * dt;
      if (inThermal(p.x) && !dive) p.vy = Math.max(p.vy - 1100 * dt, -260);   // rising warm air carries you up, gently
      p.vy = clamp(p.vy, -560, dive ? 950 : (s.wing > 0 ? 400 : 190));       // outstretched wings keep the fall slow
      p.x = clamp(p.x + p.vx * dt, 30, W - 30);
      p.y = clamp(p.y + p.vy * dt, 40, GROUND - 16);
      if (p.y <= 40) p.vy = Math.max(p.vy, 0);
      if (p.y >= GROUND - 16) { p.vy = 0; p.vx *= Math.exp(-6 * dt); s.perched = true; }
    },
    update(dt) {
      for (const f of flocks) { f.x += f.v * dt; if (f.x > W + 300) f.x = -300; if (f.x < -300) f.x = W + 300; }
      balloon.x += 14 * dt; balloon.y = 1300 + Math.sin(balloon.x * 0.004) * 80; if (balloon.x > W - 200) balloon.x = 400;
    },
    draw(t, frame, st, p) {
      const bh = GROUND / P.bands.length;
      P.bands.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(view.x - 20, i === 0 ? -2000 : i * bh, view.w + 40, i === P.bands.length - 1 ? 4000 : bh + (i === 0 ? 2000 : 0)); });
      circle(par(4200, 0.15), 900 + view.y * 0.8, 160, P.sun, false);
      for (const c of backClouds) if (visible(c.x, 400)) drawCloud(c);
      // thermals: wavy lines climbing in flip-book steps
      ink(2, 'rgba(255, 255, 255, 0.55)');
      for (const th of thermals) {
        if (!visible(th.x, 200)) continue;
        for (let k = -2; k <= 2; k++) {
          const x = th.x + k * 44, ph = (frame % 4) * 30;
          ctx.beginPath(); for (let y = GROUND; y > GROUND - 2600; y -= 20) ctx.lineTo(x + Math.sin((y + ph) * 0.03 + k) * 8, y - ((frame % 4) * 10)); ctx.stroke();
        }
      }
      // a striped hot-air balloon
      const bx = balloon.x, by = balloon.y;
      ctx.save(); ctx.beginPath(); ctx.ellipse(bx, by, 90, 110, 0, 0, 7); ctx.clip();
      for (let k = -4; k <= 4; k++) { ctx.fillStyle = k % 2 ? P.red : P.cream; ctx.fillRect(bx + k * 22 - 11, by - 120, 22, 240); }
      ctx.restore();
      ink(1.5); ctx.beginPath(); ctx.moveTo(bx - 50, by + 90); ctx.lineTo(bx - 20, by + 170); ctx.moveTo(bx + 50, by + 90); ctx.lineTo(bx + 20, by + 170); ctx.stroke();
      box(bx - 24, by + 170, 48, 32, '#a67a55', 1.5);
      // flocks in V formation, wings flicking
      for (const f of flocks) {
        if (!visible(f.x, 300)) continue;
        ink(3, '#2a2a2a');
        for (let i = 0; i < f.n; i++) {
          const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
          const x = f.x - Math.sign(f.v) * row * 34, y = f.y + side * row * 24, w = (frame + i) % 2 ? 8 : -2;
          ctx.beginPath(); ctx.moveTo(x - 12, y - w); ctx.lineTo(x, y); ctx.lineTo(x + 12, y - w); ctx.stroke();
        }
      }
      // kites on long strings from the rooftops
      for (const k of kites) {
        if (!visible(k.x, 300)) continue;
        const sway = (frame % 4 < 2 ? -10 : 10);
        ink(1, '#3b3b3b'); ctx.beginPath(); ctx.moveTo(k.x + 200, GROUND - 60); ctx.quadraticCurveTo(k.x + 120, k.y + 300, k.x + sway, k.y + 60); ctx.stroke();
        poly([[k.x + sway, k.y], [k.x + 40 + sway, k.y + 50], [k.x + sway, k.y + 120], [k.x - 40 + sway, k.y + 50]], k.c);
        ink(2, k.c); ctx.beginPath(); ctx.moveTo(k.x + sway, k.y + 120); for (let i = 1; i < 6; i++) ctx.lineTo(k.x + sway + (i % 2 ? 14 : -14), k.y + 120 + i * 24); ctx.stroke();
      }
      // the town far below
      for (const h of houses) {
        if (!visible(h.x, 300)) continue;
        ctx.fillStyle = h.c; ctx.fillRect(h.x, GROUND - h.h, h.w, h.h + 400);
        if (h.roof === 'gable') poly([[h.x - 8, GROUND - h.h], [h.x + h.w / 2, GROUND - h.h - 60], [h.x + h.w + 8, GROUND - h.h]], '#56647a');
        else if (h.roof === 'dome') { ctx.fillStyle = '#56647a'; ctx.beginPath(); ctx.arc(h.x + h.w / 2, GROUND - h.h, h.w / 3, Math.PI, 0); ctx.fill(); }
        ctx.fillStyle = '#e8c547';
        for (let wy = GROUND - h.h + 24; wy < GROUND - 20; wy += 40) for (let wx = h.x + 18; wx < h.x + h.w - 20; wx += 36) if ((wx * 7 + wy) % 5 < 2) ctx.fillRect(wx, wy, 14, 18);
      }
      ctx.fillStyle = '#4d5b70'; ctx.fillRect(view.x - 20, GROUND, view.w + 40, 400);
      // portal dressing: a floating window frame, a hole into the night, a door on a rooftop
      const hw = portals[0]; box(hw.x - 12, hw.y - 12, hw.w + 24, hw.h + 24, '#d6a39b', 1.5);
      const rd = portals[2]; ctx.fillStyle = '#c9332a'; ctx.fillRect(rd.x - 10, rd.y - 10, rd.w + 20, rd.h + 10);
      for (const q of portals) drawPortal(q, frame, { labelAbove: q.to === 'dune', lineColor: INK });
    },
    overlay() { for (const c of frontClouds) if (visible(c.x, 400)) { ctx.globalAlpha = 0.85; drawCloud(c); ctx.globalAlpha = 1; } },
    avatar(p, frame) {
      const s = p.s, flap = s.wing > 0, perched = s.perched;
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(p.face * 1.4, 1.4);
      ctx.rotate(perched ? 0 : clamp(p.vy / 1400, -0.35, 0.5));
      poly([[-18, -2], [-34, -10], [-32, 6]], '#1f4a8a');                 // tail
      ctx.fillStyle = '#2e62b0'; ctx.beginPath(); ctx.ellipse(0, 0, 20, 13, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#f4efe3'; ctx.beginPath(); ctx.ellipse(3, 5, 12, 7, 0, 0, 7); ctx.fill();
      circle(16, -8, 9, '#2e62b0', false);
      poly([[23, -9], [34, -6], [23, -3]], '#ef7426');
      circle(18, -10, 3, '#ffffff', false); circle(19, -10, 1.6, INK, false);
      // wings: up on a flap, spread when gliding, folded when perched
      const up = flap ? (frame % 2 ? -34 : -26) : perched ? -2 : -10;
      poly([[-6, -4], [10, -4], [-2 + (flap ? 6 : 0), up]], '#1f4a8a');
      if (perched) { ink(2); ctx.beginPath(); ctx.moveTo(-2, 12); ctx.lineTo(-4, 18); ctx.moveTo(6, 12); ctx.lineTo(6, 18); ctx.stroke(); }
      ctx.restore();
    },
  };
})();

// =====================================================================
// 10. The Fridge: a pea that never stops bouncing. ← → nudge, ↑ bounces big.
// =====================================================================
const FRIDGE = (() => {
  const W = 1400, H = 2400, L = 100, R = 1300, TOP = 100, FLOOR = 2300, PEA = 20;
  const P = { wall: '#e7f1f0', rib: '#d5e5e4', glass: 'rgba(170, 214, 228, 0.55)', edge: '#8fbccb', light: '#fff3b0', red: '#e2552d', yellow: '#e8c547', green: '#2f8f4e', blue: '#2e62b0', cream: '#f4efe3' };
  const SHELVES = [520, 900, 1280, 1660, 2040].map((y, i) => ({ y, gap: i % 2 ? [L, L + 230] : [R - 230, R] }));
  const solids = [];
  for (const s of SHELVES) { if (s.gap[0] > L) solids.push({ x: L, y: s.y, w: s.gap[0] - L, h: 16 }); if (s.gap[1] < R) solids.push({ x: s.gap[1], y: s.y, w: R - s.gap[1], h: 16 }); }
  const hit = (x, y) => x - PEA < L || x + PEA > R || y - PEA < TOP || y + PEA > FLOOR || solids.some((b) => x + PEA > b.x && x - PEA < b.x + b.w && y + PEA > b.y && y - PEA < b.y + b.h);
  const motes = Array.from({ length: 60 }, () => ({ x: rr(L, R), y: rr(TOP, FLOOR), v: rr(8, 22) }));
  const portals = [
    { to: 'house', shape: 'circle', x: 700, y: 200, r: 64, exit: { x: 700, y: 360 } },
    { to: 'shapes', shape: 'tri', x: 900, y: 900 - 130, w: 170, h: 130, exit: { x: 760, y: 820 } },
    { to: 'mirror', shape: 'rect', x: 420, y: 1660 - 120, w: 150, h: 120, exit: { x: 640, y: 1600 } },
    { to: 'clock', shape: 'circle', x: 1000, y: 2040 - 50, r: 44, exit: { x: 840, y: 1990 } },
  ];
  return {
    id: 'fridge', name: 'The Fridge', swatch: ['#e7f1f0', '#aad6e4', '#e8c547'], bg: P.wall, viewH: 900,
    x0: 0, y0: 0, x1: W, y1: H, spawn: { x: 700, y: 360 }, portals,
    hint: 'You are a pea. You never stop bouncing. ← → nudge, ↑ bounces big. The light goes home.',
    place(p, spot) { p.x = spot.x; p.y = spot.y; p.vx = 0; p.vy = 0; p.s.squash = 0; },
    move(p, inp, dt) {
      const s = p.s;
      let ix = inp.ix, big = inp.upPressed || inp.iy < 0;
      if (p.target) { const dx = p.target.x - p.x; if (Math.abs(dx) < 30 && Math.abs(p.target.y - p.y) < 120) p.target = null; else { ix = Math.sign(dx) * (Math.abs(dx) > 20 ? 1 : 0); big = big || p.target.y < p.y - 150; } }
      p.vx += ix * 1100 * dt; p.vx *= Math.exp(-1.2 * dt); p.vx = clamp(p.vx, -620, 620);
      p.vy += 1500 * dt;
      const nx = p.x + p.vx * dt;
      if (hit(nx, p.y)) { p.vx = -p.vx * 0.6; } else p.x = nx;
      const ny = p.y + p.vy * dt;
      if (hit(p.x, ny)) {
        if (p.vy > 0) {   // landed: bounce, and never quite stop
          p.vy = -Math.max(Math.abs(p.vy) * 0.74, big ? 1050 : 380);
          s.squash = 0.1;
        } else p.vy = -p.vy * 0.4;
      } else p.y = ny;
      s.squash = Math.max(0, (s.squash || 0) - dt);
      if (Math.abs(p.vx) > 20) p.face = Math.sign(p.vx);
    },
    update(dt) { for (const m of motes) { m.y += m.v * dt; if (m.y > FLOOR) m.y = TOP; } },
    draw(t, frame) {
      // the fridge body, then the inside: ribbed plastic walls, a glowing bulb, glass shelves
      ctx.fillStyle = '#d9d6cf'; ctx.fillRect(view.x - 20, view.y - 20, view.w + 40, view.h + 40);
      ctx.fillStyle = P.wall; ctx.fillRect(L, TOP, R - L, FLOOR - TOP);
      ctx.fillStyle = P.rib; for (let y = TOP + 30; y < FLOOR; y += 46) ctx.fillRect(L, y, R - L, 6);
      ctx.fillStyle = 'rgba(255, 243, 176, 0.35)'; ctx.beginPath(); ctx.moveTo(700, 200); ctx.lineTo(L, 900); ctx.lineTo(R, 900); ctx.closePath(); ctx.fill();
      // shelf contents
      const on = (y) => y;
      // shelf 1 (y 520): milk, a jar of pickles, a row of bottles
      let y = on(520);
      box(260, y - 180, 90, 180, P.cream, 1.6); poly([[260, y - 180], [305, y - 220], [350, y - 180]], P.cream); ink(1.6); ctx.stroke(); ctx.fillStyle = P.blue; ctx.fillRect(260, y - 120, 90, 30);
      ctx.fillStyle = 'rgba(160, 200, 120, 0.8)'; ctx.fillRect(400, y - 130, 90, 130); box(398, y - 146, 94, 18, P.red, 1.4);
      ctx.fillStyle = '#5f8a3a'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(420 + (i % 3) * 25, y - 30 - i * 20, 9, 18, 0.3, 0, 7); ctx.fill(); }
      for (let i = 0; i < 4; i++) { const x = 560 + i * 60; ctx.fillStyle = [P.green, P.red, P.yellow, P.blue][i]; ctx.fillRect(x, y - 150, 36, 150); ctx.fillRect(x + 10, y - 190, 16, 44); }
      // shelf 2 (y 900): eggs in a carton, a lemon, the cheese wedge doorway
      y = on(900);
      ctx.fillStyle = '#c9b89a'; ctx.fillRect(200, y - 40, 340, 40);
      for (let i = 0; i < 6; i++) { ctx.fillStyle = '#fbf4e6'; ctx.beginPath(); ctx.ellipse(230 + i * 55, y - 58, 22, 30, 0, 0, 7); ctx.fill(); ink(1.2); ctx.stroke(); }
      circle(640, y - 40, 40, P.yellow, true, 1.4);
      poly([[880, y], [1090, y], [1090, y - 150]], '#f2c230');
      // shelf 3 (y 1280): a cake with a slice missing, butter
      y = on(1280);
      ctx.fillStyle = '#f2b9c6'; ctx.fillRect(300, y - 120, 260, 120); ctx.fillStyle = P.cream; ctx.fillRect(300, y - 132, 260, 16);
      ctx.fillStyle = P.wall; poly([[430, y - 132], [560, y - 132], [560, y]], P.wall);
      for (let i = 0; i < 5; i++) circle(320 + i * 24, y - 140, 8, P.red, false);
      box(760, y - 50, 150, 50, '#fff0a6', 1.4);
      // shelf 4 (y 1660): the wobbly jelly doorway, a bowl of cherries
      y = on(1660);
      ctx.fillStyle = '#c9e3ec'; ctx.beginPath(); ctx.ellipse(1000, y - 34, 110, 34, 0, 0, Math.PI); ctx.fill(); ink(1.4); ctx.stroke();
      for (let i = 0; i < 7; i++) circle(930 + i * 22, y - 50 - (i % 2) * 14, 13, '#b8162b', false);
      // shelf 5 (y 2040): the egg doorway sits in a cup; a stack of cheese slices
      y = on(2040);
      ctx.fillStyle = P.blue; ctx.fillRect(956, y - 30, 88, 30);
      for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#f2c230' : '#e8b53a'; ctx.fillRect(300, y - 12 - i * 12, 160, 12); }
      // crisper drawers at the bottom
      for (const [x0, x1] of [[L + 20, 680], [720, R - 20]]) { ctx.fillStyle = 'rgba(170, 214, 228, 0.45)'; ctx.fillRect(x0, 2100, x1 - x0, 190); ink(2, P.edge); ctx.strokeRect(x0, 2100, x1 - x0, 190); for (let i = 0; i < 5; i++) circle(x0 + 60 + i * 100, 2240 - (i % 2) * 30, 36, i % 2 ? '#2f8f4e' : '#e2552d', false); }
      // glass shelves over everything they hold up
      for (const b of solids) { ctx.fillStyle = P.glass; ctx.fillRect(b.x, b.y, b.w, b.h); ink(2, P.edge); ctx.strokeRect(b.x, b.y, b.w, b.h); }
      for (const q of portals) {
        if (q.to === 'mirror') { ctx.save(); const wob = frame % 2 ? 6 : -6; ctx.translate(q.x + q.w / 2, q.y + q.h); ctx.transform(1, 0, wob / 100, 1, 0, 0); ctx.translate(-(q.x + q.w / 2), -(q.y + q.h)); drawPortal(q, frame, { lineColor: '#b8162b', labelAbove: true }); ctx.restore(); }
        else drawPortal(q, frame, { lineColor: q.to === 'house' ? '#e8c547' : INK, labelAbove: q.to !== 'house' });
      }
      ink(6, '#d9d6cf'); ctx.beginPath(); ctx.arc(700, 200, 70, 0, 7); ctx.stroke();
      // frost: tiny motes drifting down, and rime along the walls
      ctx.fillStyle = '#ffffff'; for (const m of motes) ctx.fillRect(m.x, m.y, 4, 4);
      ctx.fillStyle = '#ffffff'; for (let yy = TOP; yy < FLOOR; yy += 34) { ctx.fillRect(L, yy, 10 + (yy % 3) * 6, 12); ctx.fillRect(R - 10 - (yy % 4) * 5, yy + 12, 10 + (yy % 4) * 5, 12); }
    },
    avatar(p) {
      const sq = p.s.squash > 0 ? 0.7 : 1, st = p.s.squash > 0 ? 1.25 : 1;
      ctx.save(); ctx.translate(p.x, p.y + (1 - sq) * PEA); ctx.scale(st, sq);
      circle(0, 0, PEA, '#7cc04a', true, 1.6);
      circle(-7, -7, 5, '#c9eaa6', false);
      circle(4 * p.face, -3, 3, INK, false); circle(10 * p.face, -3, 3, INK, false);
      ink(2, '#3f7a2a'); ctx.beginPath(); ctx.moveTo(0, -PEA); ctx.quadraticCurveTo(6, -PEA - 12, 14, -PEA - 8); ctx.stroke();
      ctx.restore();
    },
  };
})();

// =====================================================================
// 11. The Darkroom: a moth under the red safelight. Prints hang on lines
//     and slowly develop while the moth flutters near them. Moths drift
//     towards light when you let go. Add your own photos with the button.
// =====================================================================
const PHOTO_FILES = [];   // file names in ./photos/, e.g. ['beach.jpg', 'grandma.png']
function duotone(img) {
  const s = Math.min(1, 360 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
  try {
    const d = g.getImageData(0, 0, w, h), px = d.data, r = mulberry32(w * 31 + h);
    const dark = [46, 22, 24], light = [246, 234, 220];
    for (let i = 0; i < px.length; i += 4) {
      let l = (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / 255;
      l = Math.round(clamp(l + (r() - 0.5) * 0.12, 0, 1) * 5) / 5;   // grainy, in five tones
      px[i] = dark[0] + (light[0] - dark[0]) * l; px[i + 1] = dark[1] + (light[1] - dark[1]) * l; px[i + 2] = dark[2] + (light[2] - dark[2]) * l;
    }
    g.putImageData(d, 0, 0);
  } catch (e) { /* a picture from elsewhere that can't be read back: keep it as it is */ }
  return c;
}
const DARK = (() => {
  const W = 3400, H = 1400, FLOOR = 1250;
  const LINES = [360, 780];
  const prints = [];
  for (const y of LINES) for (let x = 520; x < W - 700; x += 340) prints.push({ x, y, dev: 0, img: null, n: prints.length + 1, sway: rand() * 6 });
  function hang(img) {
    const c = duotone(img);
    const slot = prints.find((q) => !q.img) || (() => { const q = { x: 520 + (prints.length % 7) * 340, y: LINES[Math.floor(prints.length / 7) % 2] + 60 * Math.floor(prints.length / 14), dev: 0, n: prints.length + 1, sway: rand() * 6 }; prints.push(q); return q; })();
    slot.img = c; slot.dev = 0;
  }
  const load = (src) => { const im = new Image(); im.onload = () => hang(im); im.src = src; };
  for (const src of (window.PHOTO_DATA || PHOTO_FILES.map((f) => 'photos/' + f))) load(src);
  const portals = [
    { to: 'house', shape: 'circle', x: 2900, y: 640, r: 50, exit: { x: 2780, y: 820 } },
    { to: 'mirror', shape: 'rect', x: 1640, y: FLOOR - 70, w: 200, h: 44, exit: { x: 1740, y: FLOOR - 200 } },
    { to: 'dune', shape: 'rect', x: 130, y: FLOOR - 260, w: 110, h: 260, exit: { x: 330, y: FLOOR - 160 } },
  ];
  const safelight = { x: 1150, y: 120 };
  return {
    id: 'dark', name: 'The Darkroom', swatch: ['#4a1111', '#e2552d', '#f6eadc'], bg: '#3d0f0f', viewH: 900,
    x0: 0, y0: 0, x1: W, y1: H, spawn: { x: 2780, y: 820 }, portals, hint: 'You are a moth. Flutter near the prints to develop them. Let go and you drift towards the light.',
    hang,
    place(p, spot) { p.x = spot.x; p.y = spot.y; },
    move(p, inp, dt) {
      let { ix, iy } = inp;
      const a = aimAt(p, 24); if (a) ({ ix, iy } = a);
      const idle = !ix && !iy;
      // flutter: the moth never flies straight
      const jx = Math.sin(t * 13.1 + 1) * 0.7 + Math.sin(t * 5.3) * 0.5, jy = Math.sin(t * 11.7) * 0.8 + Math.cos(t * 4.1) * 0.4;
      p.vx += (ix * 700 + jx * 380) * dt; p.vy += (iy * 700 + jy * 380) * dt;
      if (idle) {   // drawn to the nearest light: a developed print, or the safelight
        let best = safelight, bd = Math.hypot(safelight.x - p.x, safelight.y - p.y);
        for (const q of prints) if (q.dev > 0.6) { const d = Math.hypot(q.x - p.x, q.y + 110 - p.y); if (d < bd) { bd = d; best = { x: q.x, y: q.y + 110 }; } }
        p.vx += (best.x - p.x) / Math.max(bd, 1) * 160 * dt; p.vy += (best.y - p.y) / Math.max(bd, 1) * 160 * dt;
      }
      p.vx *= Math.exp(-2.4 * dt); p.vy *= Math.exp(-2.4 * dt);
      p.x = clamp(p.x + p.vx * dt, 60, W - 60); p.y = clamp(p.y + p.vy * dt, 80, FLOOR - 30);
      if (Math.abs(p.vx) > 20) p.face = Math.sign(p.vx);
      for (const q of prints) if (Math.hypot(q.x - p.x, q.y + 110 - p.y) < 190) q.dev = Math.min(1, q.dev + dt * 0.45);
    },
    update() {},
    draw(tt, frame) {
      ctx.fillStyle = '#3d0f0f'; ctx.fillRect(view.x - 20, view.y - 20, view.w + 40, view.h + 40);
      ctx.fillStyle = '#471414'; for (let x = 0; x < W; x += 60) ctx.fillRect(x, 0, 3, FLOOR);
      // the safelight and its glow, in rings
      for (const [r, a] of [[520, 0.06], [360, 0.08], [220, 0.12]]) circle(safelight.x, safelight.y + 40, r, `rgba(226, 85, 45, ${a})`, false);
      ctx.fillStyle = '#1e1e1e'; ctx.fillRect(safelight.x - 3, 0, 6, safelight.y);
      box(safelight.x - 50, safelight.y, 100, 60, '#e2552d', 2);
      // drying lines with prints on pegs
      for (const y of LINES) { ink(2, '#d9c7b8'); ctx.beginPath(); ctx.moveTo(300, y - 20); ctx.quadraticCurveTo(W / 2, y + 30, W - 400, y - 20); ctx.stroke(); }
      for (const q of prints) {
        const sway = Math.sin(q.sway + Math.floor(tt * 2) * 0.7) * 0.03;
        const iw = q.img ? q.img.width : 4, ih = q.img ? q.img.height : 3;
        const w = 220, h = w * ih / iw;
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(sway);
        ctx.fillStyle = '#f6eadc'; ctx.fillRect(-w / 2 - 10, 8, w + 20, h + 20);
        ctx.globalAlpha = q.dev;
        if (q.img) ctx.drawImage(q.img, -w / 2, 18, w, h);
        else {
          ctx.fillStyle = '#2e1618'; ctx.fillRect(-w / 2, 18, w, h);
          ctx.fillStyle = '#f6eadc'; ctx.font = '500 26px Jost, Futura, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(`photo ${q.n}`, 0, 18 + h / 2);
        }
        ctx.globalAlpha = 1;
        box(-30, 0, 14, 24, '#a67a55', 1); box(16, 0, 14, 24, '#a67a55', 1);
        ctx.restore();
      }
      // the counter with three trays: developer, stop, fix
      ctx.fillStyle = '#2a0b0b'; ctx.fillRect(view.x - 20, FLOOR, view.w + 40, 400);
      box(1100, FLOOR - 40, 1300, 40, '#5a1a1a', 1.5);
      for (const [x, c] of [[1200, '#8a2b22'], [1640, '#6e2a3a'], [2080, '#8a4a22']]) { box(x, FLOOR - 70, 200, 34, '#d9c7b8', 1.5); ctx.fillStyle = c; ctx.fillRect(x + 8, FLOOR - 64, 184, 22); }
      // the enlarger: a column and a head, its lamp is the way home
      ctx.fillStyle = '#1e1e1e'; ctx.fillRect(3040, 300, 22, FLOOR - 300); box(2840, 560, 220, 120, '#2a2a2a', 1.5); ctx.fillRect(2860, 680, 80, 40);
      ctx.fillStyle = 'rgba(255, 244, 220, 0.12)'; poly([[2860, 720], [2940, 720], [3010, FLOOR - 40], [2790, FLOOR - 40]], 'rgba(255, 244, 220, 0.1)');
      // the door out, with its red lamp
      box(110, FLOOR - 280, 150, 280, '#2a0b0b', 2);
      circle(185, FLOOR - 310, 16, frame % 4 < 2 ? '#ff5a3a' : '#a8321f', false);
      for (const q of portals) drawPortal(q, frame, { lineColor: '#f6eadc', labelAbove: q.to !== 'house' });
    },
    avatar(p, frame) {
      const flap = frame % 2 ? 1 : 0.35;
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(p.face * 1.3, 1.3);
      ctx.fillStyle = '#e9dcc8';
      ctx.beginPath(); ctx.ellipse(-10, -10 * flap, 20, 26 * flap + 4, -0.5, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(10, -10 * flap, 20, 26 * flap + 4, 0.5, 0, 7); ctx.fill();
      ctx.fillStyle = '#b9a58c'; circle(-12, -12 * flap, 5, '#b9a58c', false); circle(12, -12 * flap, 5, '#b9a58c', false);
      ctx.fillStyle = '#5a4636'; ctx.beginPath(); ctx.ellipse(0, 0, 5, 16, 0, 0, 7); ctx.fill();
      ink(1.4, '#5a4636'); ctx.beginPath(); ctx.moveTo(-2, -14); ctx.quadraticCurveTo(-8, -26, -14, -26); ctx.moveTo(2, -14); ctx.quadraticCurveTo(8, -26, 14, -26); ctx.stroke();
      ctx.restore();
    },
  };
})();

const WORLDS = { dark: DARK, sky: SKY, fridge: FRIDGE, house: HOUSE, night: NIGHT, dune: DUNE, stand: STAND, clock: CLOCK, shapes: SHAPES, orbit: ORBIT, mirror: MIRROR };
const WORLD_ORDER = ['house', 'night', 'dune', 'stand', 'clock', 'shapes', 'orbit', 'mirror', 'sky', 'fridge', 'dark'];

// =====================================================================
// Player, input, travel
// =====================================================================
let world = HOUSE;
resize();
const player = { x: 0, y: 0, vx: 0, vy: 0, face: 1, target: null, s: {}, armed: false };
let state = 'menu';
const keys = new Set(), pressed = new Set();
const $ = (id) => document.getElementById(id);
const ui = { addPhotos: $('addPhotos'), hud: $('hudRoot'), start: $('startScreen'), num: $('worldNum'), name: $('worldName'), toast: $('toast'), focusHint: $('focusHint') };

let toastTimer = 0;
function toast(msg, secs = 5) { ui.toast.textContent = msg; ui.toast.classList.add('on'); toastTimer = secs; }
function labelWorld() {
  ui.num.textContent = String(WORLD_ORDER.indexOf(world.id) + 1); ui.name.textContent = world.name;
  ui.addPhotos.hidden = world.id !== 'dark';
}

function enterWorld(next, from) {
  world = next;
  resize();
  Object.assign(player, { vx: 0, vy: 0, target: null, stuck: 0, s: {}, armed: false });
  let spot = null;
  if (from && next.arriveSpot) spot = next.arriveSpot(from);
  if (!spot && from) { const q = next.portals.find((x) => x.to === from); if (q) spot = q.exit; }
  spot = spot || next.spawn;
  if (next.place) next.place(player, spot); else { player.x = spot.x; player.y = spot.y; }
  labelWorld();
  snapCamera();
  toast(next.hint);
}
function start() {
  state = 'play';
  ui.start.hidden = true; ui.hud.hidden = false;
  enterWorld(HOUSE, null);
  takeFocus();
}
$('startBtn').addEventListener('click', start);
// your own photos, hung in the darkroom for this visit
$('photoInput').addEventListener('change', (e) => {
  for (const file of e.target.files) { const im = new Image(); im.onload = () => DARK.hang(im); im.src = URL.createObjectURL(file); }
  e.target.value = '';
  toast('Hung on the line. Flutter near them to develop them.');
  takeFocus();
});

// travel: a paper card slides across, the world changes behind it, the card slides away
const travel = { t: -1, to: null, from: null, swapped: false };
function goThrough(portal) {
  if (travel.t >= 0) return;
  Object.assign(travel, { t: 0, to: portal.to, from: world.id, swapped: false });
  player.target = null;
}
function updateTravel(dt) {
  if (travel.t < 0) return;
  travel.t += dt / 1.3;
  if (!travel.swapped && travel.t >= 0.5) { travel.swapped = true; enterWorld(WORLDS[travel.to], travel.from); }
  if (travel.t >= 1) travel.t = -1;
}

// Arrow keys. Inside a viewer or embed, the page only hears keys while it has focus, so it takes
// focus whenever you start or click, and shows a hint when focus is elsewhere.
const ARROW_NAMES = { ArrowUp: 'up', Up: 'up', ArrowDown: 'down', Down: 'down', ArrowLeft: 'left', Left: 'left', ArrowRight: 'right', Right: 'right' };
out.tabIndex = 0;
function takeFocus() { try { window.focus(); out.focus({ preventScroll: true }); } catch (e) { /* not focusable here */ } }
function onKey(e, down) {
  const dir = ARROW_NAMES[e.key] || ARROW_NAMES[e.code];
  if (!dir) return;
  e.preventDefault();
  if (down) { if (!keys.has(dir)) pressed.add(dir); keys.add(dir); player.target = null; } else keys.delete(dir);
}
for (const target of [window, document]) {
  target.addEventListener('keydown', (e) => onKey(e, true), true);
  target.addEventListener('keyup', (e) => onKey(e, false), true);
}
window.addEventListener('blur', () => keys.clear());
const pad = new Set();
for (const btn of document.querySelectorAll('[data-dir]')) {
  const dir = btn.dataset.dir;
  const on = (e) => { e.preventDefault(); if (!pad.has(dir)) pressed.add(dir); pad.add(dir); player.target = null; btn.classList.add('on'); takeFocus(); };
  const off = () => { pad.delete(dir); btn.classList.remove('on'); };
  btn.addEventListener('pointerdown', on);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, off);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}
const held = (dir) => keys.has(dir) || pad.has(dir);
out.addEventListener('pointerdown', (e) => {
  if (state !== 'play') return;
  takeFocus();
  player.target = { x: view.x + e.clientX / view.scale, y: view.y + e.clientY / view.scale };
});

function centerOf() { return world.center ? world.center(player) : { x: player.x, y: player.y }; }
function movePlayer(dt) {
  const inp = {
    ix: (held('right') ? 1 : 0) - (held('left') ? 1 : 0),
    iy: (held('down') ? 1 : 0) - (held('up') ? 1 : 0),
    upPressed: pressed.has('up'), downPressed: pressed.has('down'),
  };
  pressed.clear();
  world.move(player, inp, dt);
  // a portal fires when you enter it; after arriving you have to step out of it first
  const c = centerOf();
  const inside = world.portals.find((q) => inPortal(q, c));
  if (!inside) player.armed = true;
  else if (player.armed) goThrough(inside);
}

// ---------- camera ---------------------------------------------------------
function camTarget() {
  const W = world;
  if (W.fixed) return [W.fixed.x - view.w / 2, W.fixed.y - view.h / 2];
  const c = centerOf();
  const tx = clamp(c.x - view.w / 2, Math.min(W.x0, W.x1 - view.w), Math.max(W.x0, W.x1 - view.w));
  const ty = clamp(c.y - view.h * 0.5, Math.min(W.y0, W.y1 - view.h), Math.max(W.y0, W.y1 - view.h));
  return [tx, ty];
}
function snapCamera() { [view.x, view.y] = camTarget(); }
function updateCamera(dt) { const [tx, ty] = camTarget(); const k = Math.min(1, dt * 3); view.x = lerp(view.x, tx, k); view.y = lerp(view.y, ty, k); }

// ---------- render: draw the scene small, then print it with texture ------------
let t = 0;
function render(frame, st) {
  const k = view.k;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = world.bg; ctx.fillRect(0, 0, buf.width, buf.height);
  ctx.setTransform(k, 0, 0, k, -view.x * k, -view.y * k);
  world.draw(t, frame, st, player);
  if (state === 'play') world.avatar(player, frame, Math.hypot(player.vx, player.vy) > 30);
  if (world.overlay) world.overlay();
  if (player.target && state === 'play') {
    const s = view.s;
    ink(1.6 * s, ['night', 'orbit', 'mirror'].includes(world.id) ? '#ffffff' : INK);
    const { x, y } = player.target;
    ctx.beginPath(); ctx.moveTo(x - 6 * s, y); ctx.lineTo(x + 6 * s, y); ctx.moveTo(x, y - 6 * s); ctx.lineTo(x, y + 6 * s); ctx.stroke();
  }
  // print: the scene, a second pass slightly out of register, grain and fibre
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.imageSmoothingEnabled = true;
  octx.globalCompositeOperation = 'source-over'; octx.globalAlpha = 1;
  octx.drawImage(buf, 0, 0, out.width, out.height);
  const off = 2.5 * view.dpr;
  octx.globalCompositeOperation = 'multiply'; octx.globalAlpha = 0.16;
  octx.drawImage(buf, off, off * 0.6, out.width, out.height);
  octx.globalAlpha = 0.5; octx.fillStyle = GRAIN[frame % 3];
  octx.fillRect(0, 0, out.width, out.height);
  octx.globalAlpha = 0.35; octx.fillStyle = FIBRE;
  octx.fillRect(0, 0, out.width, out.height);
  octx.globalCompositeOperation = 'source-over'; octx.globalAlpha = 1;
  if (travel.t >= 0) {
    const e = travel.t < 0.5 ? travel.t * 2 : (1 - travel.t) * 2;
    const ez = e * e * (3 - 2 * e);
    const w = out.width * ez, x = travel.t < 0.5 ? 0 : out.width - w;
    octx.fillStyle = PAPER; octx.fillRect(x, 0, w, out.height);
    octx.fillStyle = '#e2552d'; octx.fillRect(x, 0, w, 10 * view.dpr);
    if (ez > 0.9) {
      const dest = WORLDS[travel.to], n = WORLD_ORDER.indexOf(dest.id) + 1, s = view.dpr;
      octx.fillStyle = '#e2552d'; octx.fillRect(out.width / 2 - 150 * s, out.height / 2 - 42 * s, 84 * s, 84 * s);
      octx.fillStyle = PAPER; octx.font = `500 ${46 * s}px Jost, Futura, sans-serif`; octx.textAlign = 'center'; octx.textBaseline = 'middle';
      octx.fillText(String(n), out.width / 2 - 108 * s, out.height / 2 + 2 * s);
      octx.fillStyle = INK; octx.font = `500 ${30 * s}px Jost, Futura, sans-serif`; octx.textAlign = 'left';
      octx.fillText(dest.name, out.width / 2 - 50 * s, out.height / 2 + 2 * s);
    }
  }
}

// ---------- main loop ---------------------------------------------------------
let last = performance.now(), menuT = 0, hudTimer = 0;
const MENU_PATH = [[900, 420], [1500, 900], [700, 1200], [1500, 1500], [1300, 600]];
const ghost = { x: -9999, y: -9999, vx: 0, vy: 0, face: 1, s: {} };
function frameLoop(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;
  if (!document.hidden) t += dt;
  const frame = Math.floor(t * STEP_FPS);
  const st = frame / STEP_FPS;
  if (state === 'play') {
    if (travel.t < 0 || travel.swapped) movePlayer(dt);
    updateTravel(dt);
    updateCamera(dt);
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) ui.toast.classList.remove('on'); }
    hudTimer -= dt;
    if (hudTimer < 0) { hudTimer = 0.25; ui.focusHint.hidden = document.hasFocus(); }
  } else {
    menuT += dt * 0.04;
    const i = Math.floor(menuT) % MENU_PATH.length, f = menuT % 1, a = MENU_PATH[i], b = MENU_PATH[(i + 1) % MENU_PATH.length];
    const e = f * f * (3 - 2 * f);
    const tx = clamp(lerp(a[0], b[0], e) - view.w / 2, 0, Math.max(0, HOUSE.x1 - view.w)), ty = clamp(lerp(a[1], b[1], e) - view.h * 0.45, 0, Math.max(0, HOUSE.y1 - view.h));
    const k = Math.min(1, dt * 3); view.x = lerp(view.x, tx, k); view.y = lerp(view.y, ty, k);
  }
  world.update(dt, t, frame, state === 'play' ? player : ghost);
  render(frame, st);
  requestAnimationFrame(frameLoop);
}
requestAnimationFrame(frameLoop);

// exposed for tinkering from the console
window.deepHouse = { player, WORLDS, get world() { return world.id; }, go: (id) => goThrough({ to: id }) };
