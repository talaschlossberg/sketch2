// =====================================================================
// Deep House: a flooded house with doors to other places.
// Not a game: no air, no clock, no score. Swim around the house, and
// swim into a glowing window, painting, wardrobe or door to go through.
//
// Each world has its own palette, point of view and way of moving:
//   house     side view, floating under water
//   dune      side view, walking and jumping over desert dunes
//   snow      seen from above, walking (and sliding on ice), leaving footprints
//   night     side view, drifting through a starry sky
//   stand     side view, climbing enormous grey bleachers
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

// ---------- canvases: a small scene buffer, printed onto the screen ------------
const out = document.createElement('canvas');
document.getElementById('game').appendChild(out);
const octx = out.getContext('2d');
const buf = document.createElement('canvas');
const ctx = buf.getContext('2d');
const view = { w: 0, h: 0, scale: 1, dpr: 1, x: 0, y: 0, k: 1 };  // x,y = world coords of the top-left corner
function resize() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = window.innerWidth, ch = window.innerHeight;
  out.width = Math.round(cw * view.dpr); out.height = Math.round(ch * view.dpr);
  out.style.width = cw + 'px'; out.style.height = ch + 'px';
  buf.width = Math.round(out.width * LOFI); buf.height = Math.round(out.height * LOFI);
  view.scale = Math.min(ch / 760, cw / 520);
  view.w = cw / view.scale; view.h = ch / view.scale;
  view.k = view.scale * view.dpr * LOFI;
}
resize();
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
// three grain tiles, cycled like film grain
const GRAIN = [11, 12, 13].map((seed) => octx.createPattern(tile(200, (g, s) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
  const r = mulberry32(seed);
  for (let i = 0; i < 5200; i++) { const v = 150 + Math.floor(r() * 100); g.fillStyle = `rgb(${v},${v - 2},${v - 8})`; g.fillRect(r() * s, r() * s, 1 + r(), 1 + r()); }
}), 'repeat'));
// paper fibres and colored-pencil strokes, fixed like the page itself
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

// ---------- drawing helpers ---------------------------------------------------------
const INK = '#1e1e1e';
function ink(w = 1.5, color = INK) { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
function box(x, y, w, h, fill, lw = 1.5) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); ink(lw); ctx.strokeRect(x, y, w, h); }
function circle(x, y, r, fill, stroke = true, lw = 1.5) { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); if (stroke) { ink(lw); ctx.stroke(); } }
function poly(pts, fill) { ctx.fillStyle = fill; ctx.beginPath(); for (const [x, y] of pts) ctx.lineTo(x, y); ctx.closePath(); ctx.fill(); }
function splat(x, y, r, color, rot) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, rad = i % 2 ? r * 0.28 : r * (i % 4 ? 0.75 : 1);
    ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, 7); ctx.fill();
  ctx.restore();
}
// a layer drawn with parallax: things placed at layer x appear to move slower than the camera
const par = (lx, f) => lx + view.x * (1 - f);
const visible = (x, pad = 200) => x > view.x - pad && x < view.x + view.w + pad;

// =====================================================================
// World 1: the house
// =====================================================================
const HOUSE = (() => {
  const W = 2600, H = 1900, WL = 470, GROUND = 1700;
  const P = {
    sky: '#bcd2e8', lawn: '#4a9660', siding: '#e6ddc8', sidingLine: '#cfc4a8', roof: '#6b5a4e', roofLine: '#56483e',
    trim: '#d6a39b', red: '#e2552d', blue: '#2e62b0', green: '#2f8f4e', mint: '#8fcaa6', pink: '#e8b4ad', yellow: '#e8c547',
    grey: '#9b9b9b', greyLight: '#cdcac3', brown: '#6b4a3a', wood: '#a67a55', white: '#ffffff', cream: '#efe7d3', paper: '#f4efe3',
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
  const solids = [
    { x: 0, y: 0, w: W, h: 400 }, { x: 0, y: 0, w: 224, h: H }, { x: 2376, y: 0, w: W - 2376, h: H }, { x: 0, y: 1672, w: W, h: H - 1672 },
  ];
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

  // the four ways out
  const portals = [
    { to: 'night', shape: 'circle', x: 1300, y: 520, r: 44, colors: ['#1b2250', '#2d3a7a', '#f4e9b8'] },
    { to: 'stand', shape: 'rect', x: 370, y: 786, w: 140, h: 88, colors: ['#bdbdbd', '#2f8f4e', '#ece6d4'] },
    { to: 'snow', shape: 'rect', x: 1693, y: 1158, w: 84, h: 190, colors: ['#eef2f5', '#2d5a45', '#cfe3ee'] },
    { to: 'dune', shape: 'rect', x: 2228, y: 1502, w: 84, h: 170, colors: ['#f3c3a6', '#e9b67f', '#e2552d'] },
  ];
  const arrivals = { night: { x: 1300, y: 610 }, stand: { x: 440, y: 950 }, snow: { x: 1640, y: 1280 }, dune: { x: 2150, y: 1600 } };

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
        box(x - 26, y - 200, 52, 200, P.wood); circle(x, y - 166, 18, P.paper);
        ink(1.5); ctx.beginPath(); ctx.moveTo(x, y - 166); ctx.lineTo(x, y - 178); ctx.moveTo(x, y - 166); ctx.lineTo(x + 9, y - 162); ctx.stroke();
        const sw = (Math.floor(st * 2) % 2) ? 8 : -8;
        ctx.beginPath(); ctx.moveTo(x, y - 140); ctx.lineTo(x + sw, y - 70); ctx.stroke();
        circle(x + sw, y - 66, 7, P.yellow);
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
  // portal frames (the openings themselves are drawn by drawPortal)
  function portalFrames() {
    // painting frame
    box(362, 778, 156, 104, '#8a6a4a', 2);
    // wardrobe doors swung open
    box(1693 - 26, 1158, 26, 190, P.mint, 1.4); box(1777, 1158, 26, 190, P.mint, 1.4);
    ink(1.8); ctx.strokeRect(1693, 1158, 84, 190);
    // red door, open against the wall
    box(2312, 1502, 30, 170, P.red, 1.6); circle(2334, 1590, 3.5, P.yellow, false);
    ctx.fillStyle = P.yellow; ctx.fillRect(2220, 1668, 100, 4);
    ink(1.8); ctx.strokeRect(2228, 1502, 84, 170);
    // round attic window frame
    ctx.lineWidth = 7; ctx.strokeStyle = P.trim; ctx.beginPath(); ctx.arc(1300, 520, 48, 0, 7); ctx.stroke();
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
    id: 'house', name: 'The House', mode: 'float', W, H, hw: 30, hh: 12, spawn: { x: 520, y: WL + 20 }, arrivals, portals, bg: P.sky,
    hint: 'Swim with the arrows. The glowing window, painting, wardrobe and door lead somewhere else.',
    hits,
    update(dt, t, frame, player) {
      for (const s of schools) {
        s.x += s.dir * s.speed * dt;
        if (s.dir > 0 && s.x > s.room.x1 - 40) { s.dir = -1; s.x = s.room.x1 - 40 - s.width; }
        if (s.dir < 0 && s.x < s.room.x0 + 40) { s.dir = 1; s.x = s.room.x0 + 40 + s.width; }
        for (const m of s.members) {
          const px = s.x - s.dir * m.ox + m.dx, py = s.y + m.oy + m.dy;
          const ddx = px - player.x, ddy = py - player.y, d = Math.hypot(ddx, ddy);
          if (d < 130 && d > 1) { m.dx += ddx / d * (130 - d) * 3 * dt; m.dy += ddy / d * (130 - d) * 3 * dt; }
          const k = Math.exp(-1.5 * dt);
          m.dx *= k; m.dy *= k;
          m.x = clamp(px, s.room.x0 + 20, s.room.x1 - 20);
          m.y = clamp(py, Math.max(s.room.y0 + 16, WL + 12), s.room.y1 - 16);
        }
      }
      for (const j of jellies) { j.x = j.hx; j.y = j.hy + (frame % 4 < 2 ? -5 : 5); }
      player.breath = (player.breath ?? 3) - dt;
      if (player.breath < 0) { player.breath = rr(3, 4.5); for (let i = 0; i < 5; i++) bubbles.push({ x: player.x + player.face * 34, y: player.y - 12 - i * 8, r: rr(2.5, 5), vy: rr(45, 75) }); }
      for (const b of bubbles) b.y -= b.vy * dt;
      for (let i = bubbles.length - 1; i >= 0; i--) { const b = bubbles[i]; if (b.y < WL + 4 || solids.some((s) => b.x > s.x && b.x < s.x + s.w && b.y > s.y && b.y < s.y + s.h)) bubbles.splice(i, 1); }
    },
    draw(t, frame, st) {
      ctx.fillStyle = P.sky; ctx.fillRect(0, 0, W, GROUND);
      ctx.fillStyle = TEX.cloud;
      for (const c of clouds) { ctx.beginPath(); for (const p of c.parts) { ctx.moveTo(c.x + p.dx + p.rx, c.y + p.dy); ctx.ellipse(c.x + p.dx, c.y + p.dy, p.rx, p.ry, 0, 0, 7); } ctx.fill(); }
      ctx.fillStyle = P.brown; ctx.fillRect(96, 180, 12, GROUND - 180); ctx.fillRect(66, 204, 72, 6);
      ctx.fillStyle = TEX.lawn; ctx.fillRect(0, GROUND, W, H - GROUND);
      ctx.fillStyle = P.white;
      for (let k = 0; k < 6; k++) { const x = 2440 + k * 22; poly([[x, GROUND], [x, GROUND - 70], [x + 7, GROUND - 80], [x + 14, GROUND - 70], [x + 14, GROUND]], P.white); }
      ctx.fillRect(2436, GROUND - 56, 136, 7); ctx.fillRect(2436, GROUND - 26, 136, 7);
      for (const r of ROOMS) wallpaper(r);
      for (const s of splats) splat(s.x, s.y, s.r, s.color, s.rot);
      for (const th of things) thing(th, st);
      portalFrames();
      for (const p of portals) drawPortal(p, frame);
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
// World 2: the dune (walk and jump)
// =====================================================================
const DUNE = (() => {
  const W = 5200, H = 1400;
  const P = { sky: ['#f7dcc4', '#f4ccb2', '#f0bba3', '#eaa994', '#e39a8c'], sand: '#e9b67f', sandDark: '#d99a62', far: '#c98a86', mid: '#dca577', mono: '#2a2320', teal: '#2f8f8a', cream: '#fbf1dc', red: '#d2472c', blue: '#2e62b0' };
  const groundAt = (x) => {
    let g = 1000 + Math.sin(x * 0.0018) * 120 + Math.sin(x * 0.0047 + 1) * 60 + Math.sin(x * 0.011) * 14;
    g -= Math.max(0, 260 - x) * 1.6 + Math.max(0, x - (W - 260)) * 1.6;
    return g;
  };
  const sandTex = stipple(P.sand, ['#dfa56c', '#f1c690', '#d69458', '#f6d3a4'], 1500, 96, 0.5, 1.3, 21);
  const monoliths = [];
  for (let x = 700; x < W - 400; x += rr(380, 700)) {
    const kind = pick(['slab', 'slab', 'sphere', 'arch', 'stack']);
    monoliths.push({ x, kind, h: rr(180, 320), tilt: rr(-0.08, 0.08) });
  }
  const weeds = Array.from({ length: 7 }, (_, i) => ({ x: rr(400, W - 400), y: 0, vy: 0, r: rr(16, 28), spin: 0, speed: rr(60, 110), seed: i }));
  const streaks = Array.from({ length: 40 }, () => ({ x: rr(0, W), y: rr(700, 1150), l: rr(20, 60), v: rr(160, 280) }));
  const farMesas = []; for (let x = -400; x < W; x += rr(300, 600)) farMesas.push({ x, w: rr(200, 420), h: rr(90, 190) });
  const portals = [{ to: 'house', shape: 'rect', x: 300, y: 0, w: 70, h: 150, colors: ['#bcd2e8', '#efdcd2', '#e6ddc8'], door: true }];
  portals[0].y = groundAt(335) - 150;

  return {
    id: 'dune', name: 'The Dune', mode: 'walk', W, H, hw: 14, hh: 58, gravity: 1500, jump: 640, walk: 240, stepUp: 16,
    spawn: { x: 470, y: groundAt(470) }, portals, arrivals: {}, groundAt, bg: P.sky[0],
    hint: 'Walk with ← and →, jump with ↑. The blue door goes back to the house.',
    update(dt) {
      for (const w of weeds) {
        w.x += w.speed * dt; if (w.x > W - 200) w.x = 300;
        const g = groundAt(w.x) - w.r;
        w.vy += 1200 * dt; w.y += w.vy * dt;
        if (w.y > g) { w.y = g; w.vy = -rr(220, 380); }
        w.spin += w.speed * dt / w.r;
      }
      for (const s of streaks) { s.x += s.v * dt; if (s.x > view.x + view.w + 100) { s.x = view.x - 100; s.y = rr(view.y, view.y + view.h); } }
    },
    draw(t, frame, st) {
      const top = view.y - 20, bot = view.y + view.h + 20;
      // sky in hard bands
      ctx.fillStyle = P.sky[P.sky.length - 1]; ctx.fillRect(view.x - 20, top, view.w + 40, bot - top);
      P.sky.forEach((c, i) => { if (i === P.sky.length - 1) return; const y0 = i === 0 ? -2000 : i * 160; ctx.fillStyle = c; ctx.fillRect(view.x - 20, y0, view.w + 40, (i + 1) * 160 - y0); });
      // a very large sun
      const sx = par(2600, 0.1), sy = 330;
      circle(sx, sy, 190, P.cream, false);
      ink(2, '#f0c9a8'); for (let r = 210; r < 330; r += 26) { ctx.beginPath(); ctx.arc(sx, sy, r, Math.PI, 0); ctx.stroke(); }
      // far mesas and near dunes, in parallax
      for (const m of farMesas) { const x = par(m.x, 0.35); const base = 920; poly([[x, base], [x + 30, base - m.h], [x + m.w - 30, base - m.h], [x + m.w, base]], P.far); }
      ctx.fillStyle = P.far; ctx.fillRect(view.x - 20, 918, view.w + 40, 400);
      ctx.fillStyle = P.mid; ctx.beginPath(); ctx.moveTo(view.x - 20, bot);
      for (let x = view.x - 20; x <= view.x + view.w + 20; x += 20) { const lx = x - view.x * 0.35; ctx.lineTo(x, 960 + Math.sin(lx * 0.004) * 50 + Math.sin(lx * 0.0093) * 22); }
      ctx.lineTo(view.x + view.w + 20, bot); ctx.closePath(); ctx.fill();
      // heat shimmer lines near the horizon, flipping between two drawings
      ink(1.4, '#f8e2cc');
      for (let k = 0; k < 4; k++) {
        const y = 900 + k * 14, ph = (frame % 2) * 12;
        ctx.beginPath(); for (let x = view.x; x < view.x + view.w; x += 12) ctx.lineTo(x, y + Math.sin((x + ph + k * 30) * 0.05) * 2.5); ctx.stroke();
      }
      // monoliths standing in the sand
      for (const m of monoliths) {
        if (!visible(m.x, 300)) continue;
        const g = groundAt(m.x);
        ctx.save(); ctx.translate(m.x, g + 10); ctx.rotate(m.tilt);
        if (m.kind === 'slab') { ctx.fillStyle = P.mono; ctx.fillRect(-34, -m.h, 68, m.h); }
        else if (m.kind === 'sphere') circle(0, -m.h * 0.35, m.h * 0.42, P.teal, false);
        else if (m.kind === 'arch') { ink(34, P.red); ctx.lineCap = 'butt'; ctx.beginPath(); ctx.arc(0, 0, m.h * 0.55, Math.PI, 0); ctx.stroke(); }
        else { circle(0, -40, 40, P.blue, false); ctx.fillStyle = P.cream; ctx.fillRect(-26, -150, 52, 70); circle(0, -178, 28, P.red, false); }
        ctx.restore();
      }
      // the ground
      const x0 = view.x - 20, x1 = view.x + view.w + 20;
      ctx.fillStyle = sandTex; ctx.beginPath(); ctx.moveTo(x0, bot + 400);
      for (let x = x0; x <= x1; x += 10) ctx.lineTo(x, groundAt(x));
      ctx.lineTo(x1, bot + 400); ctx.closePath(); ctx.fill();
      ink(1.5, P.sandDark);
      for (let x = Math.floor(x0 / 90) * 90; x < x1; x += 90) for (let d = 1; d <= 3; d++) {
        const y = groundAt(x) + d * 34; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 22, y - 6, x + 44, y); ctx.stroke();
      }
      // tumbleweeds: tangled scribbles, rolling
      for (const w of weeds) {
        if (!visible(w.x)) continue;
        ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(Math.floor(w.spin * 3) / 3);
        ink(1.6, '#8a5a36');
        const r2 = mulberry32(w.seed + 50);
        ctx.beginPath(); for (let i = 0; i < 14; i++) { const a = r2() * 6.28, b = r2() * 6.28; ctx.moveTo(Math.cos(a) * w.r, Math.sin(a) * w.r); ctx.quadraticCurveTo(0, 0, Math.cos(b) * w.r, Math.sin(b) * w.r); } ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, w.r, 0, 7); ctx.stroke();
        ctx.restore();
      }
      ink(1.2, '#fbe6cf');
      for (const s of streaks) { ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + s.l, s.y); ctx.stroke(); }
      for (const p of portals) drawPortal(p, frame);
    },
    avatar(p, frame, moving) {
      // a walker under a striped parasol
      const k = moving && p.grounded ? (frame % 2 ? 1 : -1) : 0;
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(p.face, 1);
      ink(3); ctx.beginPath(); ctx.moveTo(-3, -26); ctx.lineTo(-6 - k * 7, 0); ctx.moveTo(3, -26); ctx.lineTo(6 + k * 7, 0); ctx.stroke();
      poly([[0, -70], [16, -22], [-16, -22]], P.cream); ink(1.4); ctx.stroke();
      circle(0, -80, 10, '#8a5a36', false);
      ink(2); ctx.beginPath(); ctx.moveTo(6, -54); ctx.lineTo(14, -112); ctx.stroke();
      ctx.save(); ctx.translate(14, -112); ctx.rotate(0.15);
      for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? P.cream : P.red; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 40, Math.PI + (i * Math.PI) / 6, Math.PI + ((i + 1) * Math.PI) / 6); ctx.closePath(); ctx.fill(); }
      ctx.restore();
      ctx.restore();
    },
  };
})();

// =====================================================================
// World 3: the snowfield, seen from above (walk; slide on ice)
// =====================================================================
const SNOW = (() => {
  const W = 3200, H = 3200;
  const P = { snow: '#eef2f5', dot: '#d7e1e9', pine: '#2d5a45', pine2: '#3f7a5c', ice: '#cfe3ee', iceLine: '#a9c9da', red: '#d2472c', rock: '#8e969b', blue: '#2e62b0', orange: '#ef7426', ink: INK };
  const snowTex = stipple(P.snow, ['#dde6ee', '#e6edf3', '#ffffff', '#d2dde7'], 700, 96, 0.6, 1.6, 31);
  const pond = { x: 1700, y: 1650, rx: 460, ry: 320 };
  const onIce = (x, y) => ((x - pond.x) / pond.rx) ** 2 + ((y - pond.y) / pond.ry) ** 2 < 1;
  const trees = [];
  for (let i = 0; i < 400 && trees.length < 150; i++) {
    const x = rr(120, W - 120), y = rr(120, H - 120), r = rr(28, 62);
    if (((x - pond.x) / (pond.rx + 90)) ** 2 + ((y - pond.y) / (pond.ry + 90)) ** 2 < 1) continue;
    if (Math.hypot(x - 420, y - 420) < 260) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + r + 20)) continue;
    trees.push({ x, y, r, rot: rand() * 6 });
  }
  const rocks = Array.from({ length: 30 }, () => ({ x: rr(100, W - 100), y: rr(100, H - 100), r: rr(10, 22) })).filter((r) => !onIce(r.x, r.y));
  const trail = [];   // a line of small animal prints wandering off somewhere
  { let x = 900, y = 700, a = 0.6; for (let i = 0; i < 160; i++) { a += rr(-0.25, 0.25); x += Math.cos(a) * 26; y += Math.sin(a) * 26; trail.push({ x, y, a, s: i % 2 ? 1 : -1 }); } }
  const prints = [];
  let lastPrint = null, side = 1;
  const flakes = Array.from({ length: 160 }, () => ({ x: rr(0, 1), y: rr(0, 1), s: rr(1.5, 3.5), v: rr(0.04, 0.09) }));
  const portals = [{ to: 'house', shape: 'rect', x: 380, y: 340, w: 80, h: 130, colors: ['#bcd2e8', '#f1ead8', '#8fcaa6'], door: true, flat: true }];
  const hits = (x, y, hw) => x < hw || y < hw || x > W - hw || y > H - hw || trees.some((t) => Math.hypot(t.x - x, t.y - y) < t.r * 0.55 + hw);

  return {
    id: 'snow', name: 'The Snowfield', mode: 'top', W, H, hw: 14, hh: 14, walk: 210, spawn: { x: 520, y: 520 }, portals, arrivals: {}, bg: P.snow,
    hint: 'Walk with the arrows. The ice is slippery. The red door on the ground goes back.',
    hits, frictionAt: (x, y) => (onIce(x, y) ? 0.6 : 12),
    update(dt, t, frame, player) {
      if (!lastPrint || Math.hypot(player.x - lastPrint.x, player.y - lastPrint.y) > 20) {
        side *= -1;
        const a = Math.atan2(player.vy, player.vx);
        if (Math.hypot(player.vx, player.vy) > 30) { prints.push({ x: player.x + Math.cos(a + Math.PI / 2) * 6 * side, y: player.y + Math.sin(a + Math.PI / 2) * 6 * side, a, ice: onIce(player.x, player.y) }); if (prints.length > 600) prints.shift(); }
        lastPrint = { x: player.x, y: player.y };
      }
      for (const f of flakes) { f.y += f.v * dt; f.x += f.v * 0.4 * dt; if (f.y > 1) { f.y = 0; f.x = rand(); } if (f.x > 1) f.x = 0; }
    },
    draw(t, frame) {
      ctx.fillStyle = snowTex; ctx.fillRect(view.x - 20, view.y - 20, view.w + 40, view.h + 40);
      ctx.fillStyle = '#dfe6ec'; ctx.fillRect(-2000, -2000, 2000, 7000); ctx.fillRect(W, -2000, 2000, 7000); ctx.fillRect(0, -2000, W, 2000); ctx.fillRect(0, H, W, 2000);
      // frozen pond with cracks
      ctx.fillStyle = P.ice; ctx.beginPath(); ctx.ellipse(pond.x, pond.y, pond.rx, pond.ry, 0, 0, 7); ctx.fill();
      ink(1.4, P.iceLine);
      const r2 = mulberry32(8);
      for (let i = 0; i < 14; i++) { let x = pond.x + (r2() - 0.5) * pond.rx * 1.4, y = pond.y + (r2() - 0.5) * pond.ry * 1.2; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (r2() - 0.5) * 90; y += (r2() - 0.5) * 60; ctx.lineTo(x, y); } ctx.stroke(); }
      // prints: a small animal's, and yours
      ctx.fillStyle = '#b9c7d3';
      for (const p of trail) if (visible(p.x, 40)) { ctx.beginPath(); ctx.ellipse(p.x + Math.cos(p.a + 1.57) * 5 * p.s, p.y + Math.sin(p.a + 1.57) * 5 * p.s, 3, 2, p.a, 0, 7); ctx.fill(); }
      for (const p of prints) { if (!visible(p.x, 40)) continue; ctx.fillStyle = p.ice ? '#b7d2e0' : '#c3d0db'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 7, 4, p.a, 0, 7); ctx.fill(); }
      for (const r of rocks) if (visible(r.x)) { circle(r.x, r.y, r.r, P.rock, false); circle(r.x - r.r * 0.2, r.y - r.r * 0.25, r.r * 0.55, '#f5f8fa', false); }
      // a snowman and a sled, seen from above
      circle(1150, 1100, 44, '#ffffff', true, 1.4); circle(1150, 1100, 30, '#ffffff', true, 1.4); circle(1150, 1100, 18, '#ffffff', true, 1.4);
      poly([[1150, 1092], [1182, 1100], [1150, 1108]], P.orange);
      ctx.fillStyle = P.red; ctx.fillRect(2380, 900, 50, 110); ink(3, INK); ctx.beginPath(); ctx.moveTo(2376, 895); ctx.lineTo(2376, 1015); ctx.moveTo(2434, 895); ctx.lineTo(2434, 1015); ctx.stroke();
      // a fence of red posts with a rope
      ink(1.4, INK); ctx.beginPath(); ctx.moveTo(700, 2300); ctx.lineTo(1500, 2380); ctx.stroke();
      for (let i = 0; i <= 8; i++) { const x = 700 + i * 100, y = 2300 + i * 10; circle(x, y, 7, P.red, false); }
      for (const p of portals) drawPortal(p, frame);
      // pines from above: rings of branches with snow on them
      for (const tr of trees) {
        if (!visible(tr.x, 80) || tr.y < view.y - 80 || tr.y > view.y + view.h + 80) continue;
        for (const [f, c] of [[1, P.pine], [0.7, P.pine2], [0.4, P.pine]]) {
          ctx.fillStyle = c; ctx.beginPath();
          for (let i = 0; i < 16; i++) { const a = tr.rot + (i / 16) * 6.283, rad = tr.r * f * (i % 2 ? 0.72 : 1); ctx.lineTo(tr.x + Math.cos(a) * rad, tr.y + Math.sin(a) * rad); }
          ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 6; i++) { const a = tr.rot * 2 + i; ctx.beginPath(); ctx.arc(tr.x + Math.cos(a) * tr.r * 0.55, tr.y + Math.sin(a) * tr.r * 0.55, 3, 0, 7); ctx.fill(); }
      }
    },
    overlay() {
      // falling snow, in front of everything
      ctx.fillStyle = '#ffffff';
      for (const f of flakes) { ctx.beginPath(); ctx.arc(view.x + f.x * view.w, view.y + f.y * view.h, f.s, 0, 7); ctx.fill(); }
    },
    avatar(p, frame, moving) {
      const a = Math.atan2(p.vy, p.vx), speed = Math.hypot(p.vx, p.vy);
      const dir = speed > 10 ? a : (p.dir ?? Math.PI / 2);
      p.dir = dir;
      const k = moving ? (frame % 2 ? 1 : -1) : 0;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(dir);
      ctx.fillStyle = INK; ctx.beginPath(); ctx.ellipse(6 + k * 6, -7, 6, 4, 0, 0, 7); ctx.ellipse(6 - k * 6, 7, 6, 4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = P.red; ctx.beginPath(); ctx.ellipse(0, 0, 11, 17, 0, 0, 7); ctx.fill();
      circle(-2, 0, 9, P.blue, false); circle(-4, 0, 3.5, '#ffffff', false);
      ctx.restore();
    },
  };
})();

// =====================================================================
// World 4: the night sky (drift)
// =====================================================================
const NIGHT = (() => {
  const W = 4200, H = 2600;
  const P = { bands: ['#10163a', '#151d48', '#1b2456', '#222c63', '#29346f'], star: '#f4e9b8', moon: '#f1e6c8', crater: '#d9cba6', rock: '#5b4a6e', grass: '#3e8a6a', lamp: '#ffd66b', pink: '#f2a6a0', ochre: '#e3a33a' };
  const stars = Array.from({ length: 700 }, () => ({ x: rr(0, W), y: rr(0, H), s: rr(0.8, 2.4), ph: Math.floor(rr(0, 4)) }));
  const islands = [];
  for (let i = 0; i < 11; i++) islands.push({ x: 300 + i * 360 + rr(-60, 60), y: rr(600, 2200), w: rr(120, 220), kind: pick(['lamp', 'house', 'tree', 'chair']) });
  const comets = [];
  const portals = [{ to: 'house', shape: 'circle', x: 520, y: 1400, r: 50, colors: ['#bcd2e8', '#dccdb0', '#d6a39b'], frame: true }];
  return {
    id: 'night', name: 'The Night Sky', mode: 'float', W, H, hw: 16, hh: 20, spawn: { x: 640, y: 1400 }, portals, arrivals: {}, bg: P.bands[0], drag: 0.8,
    hint: 'Drift with the arrows. The round window floating in the sky goes back.',
    hits: (x, y, hw, hh) => x < hw || y < hh || x > W - hw || y > H - hh,
    update(dt, t) {
      if (rand() < dt * 0.35) comets.push({ x: view.x + rr(0, view.w), y: view.y - 40, vx: rr(260, 420), vy: rr(160, 260), life: 3 });
      for (const c of comets) { c.x += c.vx * dt; c.y += c.vy * dt; c.life -= dt; }
      for (let i = comets.length - 1; i >= 0; i--) if (comets[i].life < 0) comets.splice(i, 1);
    },
    draw(t, frame, st, player) {
      const bh = H / P.bands.length;
      P.bands.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(view.x - 20, i === 0 ? -2000 : i * bh, view.w + 40, i === P.bands.length - 1 ? 4000 : bh + (i === 0 ? 2000 : 0)); });
      // the moon, far away
      const mx = par(2400, 0.15), my = 520 + view.y * 0.85;
      circle(mx, my, 230, P.moon, false);
      for (const [dx, dy, r] of [[-80, -40, 40], [60, 50, 28], [20, -110, 18], [-30, 110, 24], [110, -60, 14]]) circle(mx + dx, my + dy, r, P.crater, false);
      // a ringed planet and a small red one
      const px = par(3400, 0.3), py = 1500 + view.y * 0.7;
      circle(px, py, 70, P.ochre, false); ink(5, P.pink); ctx.beginPath(); ctx.ellipse(px, py, 120, 22, -0.3, 0, 7); ctx.stroke();
      circle(par(900, 0.25), 700 + view.y * 0.75, 26, '#d2472c', false);
      // stars twinkle in flip-book steps
      ctx.fillStyle = P.star;
      for (const s of stars) {
        if (s.x < view.x - 10 || s.x > view.x + view.w + 10 || s.y < view.y - 10 || s.y > view.y + view.h + 10) continue;
        const r = (frame + s.ph) % 4 === 0 ? s.s * 1.8 : s.s;
        ctx.fillRect(s.x - r / 2, s.y - r / 2, r, r);
      }
      // constellation lines to the nearest stars
      const near = stars.filter((s) => Math.abs(s.x - player.x) < 260 && Math.abs(s.y - player.y) < 260).map((s) => [Math.hypot(s.x - player.x, s.y - player.y), s]).sort((a, b) => a[0] - b[0]).slice(0, 4);
      ink(1, 'rgba(244, 233, 184, 0.55)'); ctx.beginPath();
      for (let i = 0; i < near.length; i++) { const s = near[i][1]; ctx.moveTo(player.x, player.y); ctx.lineTo(s.x, s.y); }
      ctx.stroke();
      ink(2, '#ffffff');
      for (const c of comets) { ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x - c.vx * 0.3, c.y - c.vy * 0.3); ctx.stroke(); circle(c.x, c.y, 4, '#ffffff', false); }
      // floating islands
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
      for (const p of portals) drawPortal(p, frame);
    },
    avatar(p, frame) {
      // a figure in a long coat carrying a lantern
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
// World 5: the grandstand (walk up enormous steps)
// =====================================================================
const STAND = (() => {
  const W = 4400, H = 1900, STEP_W = 64, STEP_H = 30, BASE = 1600;
  const P = { wall: ['#d9d9d6', '#c6c6c2', '#b3b3ae', '#9f9f99', '#8b8b85'], cream: '#ece6d4', line: '#b9b2a0', green: '#2f8f4e', case: '#3b3b3b', yellow: '#f0d84a', red: '#c9332a', orange: '#f29a3a', ceil: '#e7e1cf' };
  // the profile: a long climb, a landing, a long descent
  const groundAt = (x) => {
    if (x < 700) return BASE;
    const up = Math.floor((x - 700) / STEP_W);
    if (x < 700 + 34 * STEP_W) return BASE - (up + 1) * STEP_H;
    const peak = BASE - 34 * STEP_H;
    if (x < 700 + 34 * STEP_W + 500) return peak;
    const dn = Math.floor((x - (700 + 34 * STEP_W + 500)) / STEP_W);
    return Math.min(BASE, peak + (dn + 1) * STEP_H);
  };
  const cases = [];
  for (let x = 740; x < W - 200; x += STEP_W) if (rand() < 0.4) cases.push({ x: x + rr(8, 30) });
  const fogTex = stipple(P.yellow, ['#e8cc36', '#f7e57a', '#dcbc2c', '#fff0a0'], 1400, 96, 0.6, 1.6, 41);
  const portals = [{ to: 'house', shape: 'rect', x: 420, y: BASE - 110, w: 70, h: 110, colors: ['#bcd2e8', '#efdcd2', '#6b5a4e'], door: true, red: true }];
  return {
    id: 'stand', name: 'The Grandstand', mode: 'walk', W, H, hw: 12, hh: 52, gravity: 1600, jump: 620, walk: 230, stepUp: 34,
    spawn: { x: 560, y: BASE }, portals, arrivals: {}, groundAt, bg: P.wall[0],
    hint: 'Walk with ← and →; the steps carry you up. The small red door goes back.',
    update() {},
    draw(t, frame) {
      // graphite walls in bands, with pencil hatching
      const bh = 380;
      P.wall.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(view.x - 20, i === 0 ? -2000 : i * bh, view.w + 40, i === P.wall.length - 1 ? 4000 : bh + (i === 0 ? 2000 : 0)); });
      ink(1, 'rgba(60, 60, 60, 0.12)');
      for (let x = Math.floor(view.x / 14) * 14; x < view.x + view.w; x += 14) { ctx.beginPath(); ctx.moveTo(x, view.y); ctx.lineTo(x + 40, view.y + view.h); ctx.stroke(); }
      // an orange sun half hidden behind the far wall
      circle(par(3800, 0.4), 520, 90, P.orange, false);
      ctx.fillStyle = P.wall[1]; ctx.fillRect(par(3700, 0.4), 520, 400, 200);
      // the vast sloping roof with a grid
      ctx.fillStyle = P.ceil; ctx.beginPath(); ctx.moveTo(600, 200); ctx.lineTo(W, 60); ctx.lineTo(W, 360); ctx.lineTo(600, 480); ctx.closePath(); ctx.fill();
      ctx.save(); ctx.clip(); ink(1, P.line); ctx.setLineDash([4, 6]);
      for (let x = 600; x < W; x += 120) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 60, 600); ctx.stroke(); }
      for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(600, 200 + k * 56); ctx.lineTo(W, 60 + k * 60); ctx.stroke(); }
      ctx.restore(); ctx.setLineDash([]);
      ctx.fillStyle = P.green; ctx.beginPath(); ctx.moveTo(560, 200); ctx.lineTo(600, 200); ctx.lineTo(600, 480); ctx.lineTo(560, 520); ctx.fill();
      // traffic-light pole
      ctx.fillStyle = '#e9e9e4'; ctx.fillRect(160, 300, 26, BASE - 300);
      box(150, 260, 46, 110, '#2a2a2a', 1);
      circle(173, 285, 12, frame % 6 < 3 ? P.yellow : '#6b6a4a', false); circle(173, 315, 12, '#555', false); circle(173, 345, 12, frame % 6 >= 3 ? '#57c26a' : '#3d5b44', false);
      // the steps: a green flank, cream treads, a grid of lines
      const x0 = Math.max(0, view.x - 40), x1 = view.x + view.w + 40;
      ctx.fillStyle = P.green;
      ctx.beginPath(); ctx.moveTo(700, BASE); ctx.lineTo(700 + 34 * STEP_W, BASE - 34 * STEP_H - 120); ctx.lineTo(700 + 34 * STEP_W + 500, BASE - 34 * STEP_H - 120); ctx.lineTo(700 + 68 * STEP_W + 500, BASE); ctx.closePath(); ctx.fill();
      ctx.fillStyle = P.cream; ctx.beginPath(); ctx.moveTo(x0, H + 200);
      for (let x = x0; x <= x1; x += 4) ctx.lineTo(x, groundAt(x));
      ctx.lineTo(x1, H + 200); ctx.closePath(); ctx.fill();
      ink(1, P.line);
      for (let x = Math.floor(x0 / STEP_W) * STEP_W + 700 % STEP_W; x < x1; x += STEP_W) { ctx.beginPath(); ctx.moveTo(x, groundAt(x + 1)); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = BASE - 34 * STEP_H; y < BASE; y += STEP_H) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
      ink(1.4, INK); ctx.beginPath(); for (let x = x0; x <= x1; x += 4) ctx.lineTo(x, groundAt(x)); ctx.stroke();
      // briefcases left on the steps
      for (const c of cases) { if (!visible(c.x, 60)) continue; const g = groundAt(c.x + 12); box(c.x, g - 22, 30, 22, P.case, 1); ink(2, P.case); ctx.beginPath(); ctx.moveTo(c.x + 10, g - 22); ctx.lineTo(c.x + 10, g - 28); ctx.lineTo(c.x + 20, g - 28); ctx.lineTo(c.x + 20, g - 22); ctx.stroke(); }
      // a green railing on the landing
      ink(2.5, P.green); const lx = 700 + 34 * STEP_W, ly = BASE - 34 * STEP_H;
      ctx.beginPath(); ctx.moveTo(lx + 60, ly - 50); ctx.lineTo(lx + 440, ly - 50); for (let x = lx + 60; x <= lx + 440; x += 76) { ctx.moveTo(x, ly - 50); ctx.lineTo(x, ly); } ctx.stroke();
      for (const p of portals) drawPortal(p, frame);
      // yellow fog along the floor
      ctx.fillStyle = fogTex; ctx.beginPath(); ctx.moveTo(view.x - 20, H + 100);
      for (let x = view.x - 20; x < view.x + view.w + 40; x += 30) ctx.lineTo(x, BASE + 30 + Math.sin(x * 0.02 + (frame % 2)) * 8);
      ctx.lineTo(view.x + view.w + 40, H + 100); ctx.closePath(); ctx.fill();
    },
    avatar(p, frame, moving) {
      // a thin figure in a green coat
      const k = moving && p.grounded ? (frame % 2 ? 1 : -1) : 0;
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(p.face, 1);
      ink(3.5, '#2a2a2a'); ctx.beginPath(); ctx.moveTo(-2, -24); ctx.lineTo(-4 - k * 6, 0); ctx.moveTo(2, -24); ctx.lineTo(4 + k * 6, 0); ctx.stroke();
      ctx.fillStyle = P.green; ctx.fillRect(-9, -52, 18, 30);
      circle(0, -60, 8, '#f1e6d0', false);
      ctx.fillStyle = '#2a2a2a'; ctx.fillRect(-9, -69, 18, 5);
      ctx.restore();
    },
  };
})();

const WORLDS = { house: HOUSE, dune: DUNE, snow: SNOW, night: NIGHT, stand: STAND };
const WORLD_ORDER = ['house', 'dune', 'snow', 'night', 'stand'];
const TEX = {
  lawn: stipple('#4a9660', ['#3d8653', '#5aa56d', '#77b986', '#2f7a47'], 1800, 96, 0.5, 1.2, 4),
  cloud: stipple(null, ['#a8a8a8', '#d0d0d0', '#f0f0f0', '#ffffff'], 1800, 96, 0.4, 1.0, 5),
  plant: stipple('#2f8f4e', ['#256f3e', '#43a062', '#6cbf80'], 900, 64, 0.5, 1.1, 7),
};

// A portal: an opening that shows a flickering slice of where it leads.
function drawPortal(p, frame) {
  ctx.save();
  ctx.beginPath();
  if (p.shape === 'circle') ctx.arc(p.x, p.y, p.r, 0, 7);
  else ctx.rect(p.x, p.y, p.w, p.h);
  ctx.clip();
  const [a, b, c] = p.colors;
  const bx = p.shape === 'circle' ? p.x - p.r : p.x, by = p.shape === 'circle' ? p.y - p.r : p.y;
  const bw = p.shape === 'circle' ? p.r * 2 : p.w, bhh = p.shape === 'circle' ? p.r * 2 : p.h;
  ctx.fillStyle = a; ctx.fillRect(bx, by, bw, bhh);
  const shift = (frame % 4) * (bhh / 8);
  ctx.fillStyle = b;
  for (let y = by - bhh + shift; y < by + bhh; y += bhh / 4) ctx.fillRect(bx, y, bw, bhh / 8);
  ctx.fillStyle = c;
  for (let i = 0; i < 5; i++) { const r2 = mulberry32(i * 7 + frame % 3); ctx.beginPath(); ctx.arc(bx + r2() * bw, by + r2() * bhh, 3 + r2() * 4, 0, 7); ctx.fill(); }
  ctx.restore();
  ctx.setLineDash([6, 5]); ctx.lineDashOffset = -(frame % 4) * 3;
  ink(2, '#ffffff');
  if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 6, 0, 7); ctx.stroke(); }
  else ctx.strokeRect(p.x - 5, p.y - 5, p.w + 10, p.h + 10);
  ctx.setLineDash([]);
  if (p.door) {   // a standalone door: frame and knob around the opening
    ink(2, INK); ctx.strokeRect(p.x, p.y, p.w, p.h);
    if (p.flat) { ctx.fillStyle = '#d2472c'; ctx.fillRect(p.x - 14, p.y - 14, p.w + 28, 14); ctx.fillRect(p.x - 14, p.y + p.h, p.w + 28, 14); ctx.fillRect(p.x - 14, p.y, 14, p.h); ctx.fillRect(p.x + p.w, p.y, 14, p.h); }
    else { ctx.fillStyle = p.red ? '#c9332a' : '#2e62b0'; ctx.fillRect(p.x - 10, p.y - 10, p.w + 20, 10); ctx.fillRect(p.x - 10, p.y, 10, p.h); ctx.fillRect(p.x + p.w, p.y, 10, p.h); }
  }
  if (p.frame) { ink(7, '#d6a39b'); ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 3, 0, 7); ctx.stroke(); }
}

// =====================================================================
// Player, input, travel
// =====================================================================
let world = HOUSE;
const player = { x: HOUSE.spawn.x, y: HOUSE.spawn.y, vx: 0, vy: 0, face: 1, grounded: false, target: null, cooldown: 0 };
let state = 'menu';
const keys = new Set();
const $ = (id) => document.getElementById(id);
const ui = { hud: $('hudRoot'), start: $('startScreen'), num: $('worldNum'), name: $('worldName'), toast: $('toast'), focusHint: $('focusHint') };

let toastTimer = 0;
function toast(msg, secs = 4) { ui.toast.textContent = msg; ui.toast.classList.add('on'); toastTimer = secs; }
function labelWorld() { ui.num.textContent = String(WORLD_ORDER.indexOf(world.id) + 1); ui.name.textContent = world.name; }

function placePlayer(spot) {
  Object.assign(player, { x: spot.x, y: spot.y, vx: 0, vy: 0, target: null, grounded: false, cooldown: 1.2 });
}
function start() {
  state = 'play';
  ui.start.hidden = true; ui.hud.hidden = false;
  world = HOUSE; placePlayer(HOUSE.spawn); labelWorld();
  takeFocus();
  toast(world.hint);
}
$('startBtn').addEventListener('click', start);

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
  if (!travel.swapped && travel.t >= 0.5) {
    travel.swapped = true;
    const next = WORLDS[travel.to];
    const spot = next.arrivals[travel.from] || next.spawn;
    world = next; placePlayer(spot); labelWorld();
    snapCamera();
    toast(world.hint);
  }
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
  if (down) { keys.add(dir); player.target = null; } else keys.delete(dir);
}
for (const target of [window, document]) {
  target.addEventListener('keydown', (e) => onKey(e, true), true);
  target.addEventListener('keyup', (e) => onKey(e, false), true);
}
window.addEventListener('blur', () => keys.clear());
const pad = new Set();
for (const btn of document.querySelectorAll('[data-dir]')) {
  const dir = btn.dataset.dir;
  const on = (e) => { e.preventDefault(); pad.add(dir); player.target = null; btn.classList.add('on'); takeFocus(); };
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

function center() { return world.mode === 'walk' ? { x: player.x, y: player.y - world.hh / 2 } : { x: player.x, y: player.y }; }
function inPortal(p, c) {
  if (p.shape === 'circle') return Math.hypot(c.x - p.x, c.y - p.y) < p.r;
  return c.x > p.x && c.x < p.x + p.w && c.y > p.y && c.y < p.y + p.h;
}

function movePlayer(dt) {
  let ix = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
  let iy = (held('down') ? 1 : 0) - (held('up') ? 1 : 0);
  const tg = player.target;
  const W = world;
  if (W.mode === 'walk') {
    let wantJump = iy < 0;
    if (tg) {
      const dx = tg.x - player.x;
      if (Math.abs(dx) < 12) player.target = null; else ix = Math.sign(dx);
      if (tg.y < player.y - 90 && player.blocked) wantJump = true;
    }
    player.vx = lerp(player.vx, ix * W.walk, 1 - Math.exp(-10 * dt));
    if (wantJump && player.grounded) { player.vy = -W.jump; player.grounded = false; }
    player.vy += W.gravity * dt;
    const nx = clamp(player.x + player.vx * dt, 20, W.W - 20);
    const gAhead = W.groundAt(nx + Math.sign(player.vx) * W.hw);
    player.blocked = gAhead < player.y - W.stepUp;
    if (player.blocked) player.vx = 0; else player.x = nx;
    player.y += player.vy * dt;
    const g = W.groundAt(player.x);
    if (player.y >= g || (player.grounded && player.vy >= 0 && g - player.y < W.stepUp)) { player.y = g; player.vy = 0; player.grounded = true; }
    else player.grounded = false;
  } else {
    if (tg) {
      const dx = tg.x - player.x, dy = tg.y - player.y, d = Math.hypot(dx, dy);
      if (d < 16 || (player.stuck || 0) > 0.6) { player.target = null; player.stuck = 0; } else { ix = dx / d; iy = dy / d; }
    }
    const l = Math.hypot(ix, iy);
    if (l > 1) { ix /= l; iy /= l; }
    if (W.mode === 'top') {
      const f = W.frictionAt(player.x, player.y), k = 1 - Math.exp(-f * dt);
      player.vx = lerp(player.vx, ix * W.walk, k); player.vy = lerp(player.vy, iy * W.walk, k);
    } else {
      player.vx += ix * 800 * dt; player.vy += iy * 800 * dt;
      const drag = Math.exp(-(W.drag ?? 2.6) * dt);
      player.vx *= drag; player.vy *= drag;
    }
    const nx = player.x + player.vx * dt;
    if (W.hits(nx, player.y, W.hw, W.hh)) { player.vx = W.mode === 'top' ? -player.vx * 0.3 : 0; if (tg) player.stuck = (player.stuck || 0) + dt; } else player.x = nx;
    const ny = player.y + player.vy * dt;
    if (W.hits(player.x, ny, W.hw, W.hh)) { player.vy = W.mode === 'top' ? -player.vy * 0.3 : 0; if (tg) player.stuck = (player.stuck || 0) + dt; } else player.y = ny;
  }
  if (Math.abs(player.vx) > 20) player.face = Math.sign(player.vx);
  player.cooldown -= dt;
  if (player.cooldown <= 0) { const c = center(); for (const p of W.portals) if (inPortal(p, c)) goThrough(p); }
}

// ---------- camera ---------------------------------------------------------
function camTarget() {
  const c = center();
  const W = world;
  const tx = clamp(c.x - view.w / 2, Math.min(0, W.W - view.w), Math.max(0, W.W - view.w));
  const ty = clamp(c.y - view.h * (W.mode === 'walk' ? 0.55 : 0.45), Math.min(0, W.H - view.h), Math.max(0, W.H - view.h));
  return [tx, ty];
}
function snapCamera() { [view.x, view.y] = camTarget(); }
function updateCamera(dt) { const [tx, ty] = camTarget(); const k = Math.min(1, dt * 3); view.x = lerp(view.x, tx, k); view.y = lerp(view.y, ty, k); }

// ---------- render: draw the scene small, then print it with texture ------------
function render(t, frame, st) {
  const k = view.k;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = world.bg; ctx.fillRect(0, 0, buf.width, buf.height);
  ctx.setTransform(k, 0, 0, k, -view.x * k, -view.y * k);
  world.draw(t, frame, st, player);
  if (state === 'play') world.avatar(player, frame, Math.hypot(player.vx, player.vy) > 30);
  if (world.overlay) world.overlay();
  if (player.target && state === 'play') {
    ink(1.6, world.id === 'night' ? '#ffffff' : INK);
    const { x, y } = player.target;
    ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6); ctx.stroke();
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

  // the travel card
  if (travel.t >= 0) {
    const e = travel.t < 0.5 ? travel.t * 2 : (1 - travel.t) * 2;
    const ease = e * e * (3 - 2 * e);
    const w = out.width * ease;
    const x = travel.t < 0.5 ? 0 : out.width - w;
    octx.fillStyle = '#f4efe3'; octx.fillRect(x, 0, w, out.height);
    octx.fillStyle = '#e2552d'; octx.fillRect(x, 0, w, 10 * view.dpr);
    if (ease > 0.9) {
      const dest = WORLDS[travel.to], n = WORLD_ORDER.indexOf(dest.id) + 1, s = view.dpr;
      octx.fillStyle = '#e2552d'; octx.fillRect(out.width / 2 - 150 * s, out.height / 2 - 42 * s, 84 * s, 84 * s);
      octx.fillStyle = '#f4efe3'; octx.font = `500 ${46 * s}px Jost, Futura, sans-serif`; octx.textAlign = 'center'; octx.textBaseline = 'middle';
      octx.fillText(String(n), out.width / 2 - 108 * s, out.height / 2 + 2 * s);
      octx.fillStyle = '#1e1e1e'; octx.font = `500 ${30 * s}px Jost, Futura, sans-serif`; octx.textAlign = 'left';
      octx.fillText(dest.name, out.width / 2 - 50 * s, out.height / 2 + 2 * s);
    }
  }
}

// ---------- main loop ---------------------------------------------------------
let last = performance.now(), t = 0, menuT = 0, hudTimer = 0;
const MENU_PATH = [[900, 420], [1500, 900], [700, 1200], [1500, 1500], [1300, 600]];
snapCamera();

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
    const tx = clamp(lerp(a[0], b[0], e) - view.w / 2, 0, Math.max(0, HOUSE.W - view.w)), ty = clamp(lerp(a[1], b[1], e) - view.h * 0.45, 0, Math.max(0, HOUSE.H - view.h));
    const k = Math.min(1, dt * 3); view.x = lerp(view.x, tx, k); view.y = lerp(view.y, ty, k);
  }
  world.update(dt, t, frame, state === 'play' ? player : { x: -9999, y: -9999, vx: 0, vy: 0, face: 1 });
  render(t, frame, st);
  requestAnimationFrame(frameLoop);
}
requestAnimationFrame(frameLoop);

// exposed for tinkering from the console
window.deepHouse = { player, WORLDS, get world() { return world.id; }, go: (id) => goThrough({ to: id }) };
