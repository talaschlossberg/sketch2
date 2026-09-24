// =====================================================================
// Blue Hollow: a lagoon dive drawn as a flat elevation.
// Everything is seen straight on: stepped seabed, things in rows,
// flat colour with thin ink lines, stipple and pencil texture.
// Arrow keys (or the on-screen pad) swim; clicking swims you to a spot.
// World units are roughly pixels; 25 units = 1 metre of depth.
// =====================================================================

const W = 6400, H = 1500, SURF = 190;  // world size and water line
const UNITS_PER_M = 25;
const PEARL_COUNT = 20;
const STEP_FPS = 6;                     // ambient motion moves in small steps, like a flip book
const COL = 80, RISE = 40;              // seabed step width and height

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

// ---------- palette ---------------------------------------------------
const PAL = {
  sky: '#86b4de', paper: '#f4efe3', cream: '#ece4cf', beige: '#d8cdb2', ink: '#1e1e1e',
  grey: '#9b9b9b', greyLight: '#c8c5bd', green: '#2f8f4e', greenDark: '#23703b', greenLight: '#58b06c',
  red: '#e2552d', brick: '#c9442a', brown: '#6b4a3a', blue: '#2e62b0', pink: '#e3a9a4', yellow: '#e8c547', white: '#ffffff',
};
// water gets a shade darker every 13 m, in straight bands
const WATER = ['#bcd8e0', '#a6cad6', '#8fbacb', '#78a7bb'];
const WATER_BAND = 330;

// ---------- the stepped seabed -------------------------------------------
const NCOL = Math.ceil(W / COL);
const steps = new Float32Array(NCOL);
for (let i = 0; i < NCOL; i++) {
  const x = (i + 0.5) * COL;
  let g = 1060 + fbm(x * 0.0011, 3.7, 4) * 520;
  g += Math.exp(-(((x - 3700) / 420) ** 2)) * 300;        // the deep trench
  g += Math.exp(-(((x - 5400) / 300) ** 2)) * 140;
  g -= Math.exp(-(((x - 900) / 520) ** 2)) * 330;         // shallows near the boat
  g -= smooth(300, 0, x) * 760 + smooth(W - 300, W, x) * 760;  // lagoon walls
  steps[i] = Math.round(clamp(g, SURF + 170, H - 60) / RISE) * RISE;
}
const groundAt = (x) => steps[clamp(Math.floor(x / COL), 0, NCOL - 1)];
// runs of equal height are the treads things stand on
const platforms = [];
for (let i = 0; i < NCOL;) {
  let j = i;
  while (j + 1 < NCOL && steps[j + 1] === steps[i]) j++;
  platforms.push({ x0: i * COL, x1: (j + 1) * COL, y: steps[i], use: null });
  i = j + 1;
}

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

// ---------- textures: sponge stipple and pencil grain ------------------------
function stipple(base, colors, count, size = 96, rMin = 0.5, rMax = 1.3, seed = 3) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (base) { g.fillStyle = base; g.fillRect(0, 0, size, size); }
  const r = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.beginPath(); g.arc(r() * size, r() * size, rMin + r() * (rMax - rMin), 0, 7); g.fill();
  }
  return ctx.createPattern(c, 'repeat');
}
const TEX = {
  hedge: stipple(PAL.green, ['#1f6f38', '#3aa05a', '#6cc07a', '#23703b', '#8fcf7f'], 2200, 96, 0.5, 1.2, 4),
  cloud: stipple(null, ['#7d7d7d', '#b5b5b5', '#e8e8e8', '#ffffff', '#5a5a5a'], 2600, 96, 0.4, 1.1, 5),
  rock: stipple(PAL.grey, ['#7f7f7f', '#b9b9b9', '#6e6e6e', '#d0d0d0'], 1600, 96, 0.4, 1.1, 6),
};
const grain = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  const r = mulberry32(9);
  for (let i = 0; i < 3000; i++) { const v = 205 + Math.floor(r() * 45); g.fillStyle = `rgb(${v},${v},${v - 4})`; g.fillRect(r() * 256, r() * 256, 1, 1); }
  // colored-pencil strokes, all leaning the same way
  g.lineCap = 'round';
  for (let i = 0; i < 420; i++) {
    const v = 215 + Math.floor(r() * 35); g.strokeStyle = `rgb(${v},${v},${v - 3})`; g.lineWidth = 0.7;
    const x = r() * 256, y = r() * 256, l = 5 + r() * 12;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + l * 0.6, y - l); g.stroke();
  }
  return ctx.createPattern(c, 'repeat');
})();

// =====================================================================
// World layout: everything sits on the steps in evenly spaced rows
// =====================================================================
const clams = [];
{
  const eligible = platforms.filter((p) => p.x0 > 320 && p.x1 < W - 320);
  const slots = [];
  for (const p of eligible) {
    const n = Math.max(1, Math.floor((p.x1 - p.x0) / 140));
    for (let k = 0; k < n; k++) slots.push({ p, x: p.x0 + ((k + 0.5) / n) * (p.x1 - p.x0) });
  }
  for (let k = 0; k < PEARL_COUNT && k < slots.length; k++) {
    const s = slots[Math.round(((k + 0.5) * slots.length) / PEARL_COUNT - 0.5)];
    s.p.use = 'clams';
    clams.push({ x: s.x, y: s.p.y, taken: false, color: [PAL.red, PAL.yellow, PAL.blue, PAL.grey][k % 4], phase: k });
  }
}
// each remaining tread gets one arrangement
const scenery = [];
const vents = [];
const poles = [300, 1750, 3300, 4850].map((x) => ({ x: Math.floor(x / COL) * COL + COL / 2 }));
for (const p of platforms) {
  const w = p.x1 - p.x0, cx = (p.x0 + p.x1) / 2;
  if (p.x0 < 160 || p.x1 > W - 160) continue;
  const row = (gap, make) => {
    const n = Math.max(1, Math.floor((w - 30) / gap));
    for (let k = 0; k < n; k++) make(p.x0 + ((k + 0.5) / n) * w, k);
  };
  if (p.use === 'clams') {
    if (w >= 240 && clams.filter((c) => c.x > p.x0 && c.x < p.x1).length === 1) { scenery.push({ type: 'star', x: p.x0 + 26, y: p.y }); scenery.push({ type: 'star', x: p.x1 - 26, y: p.y }); }
    continue;
  }
  const deep = p.y > 1150, shallow = p.y < 950;
  const r = rand();
  if (deep && r < 0.2 && w >= 120) {
    scenery.push({ type: 'vent', x: cx, y: p.y }); vents.push({ x: cx, y: p.y - 92 }); p.use = 'vent';
  } else if (r < (shallow ? 0.3 : 0.12) && w >= 160) {
    scenery.push({ type: 'hedge', x0: p.x0 + 8, x1: p.x1 - 8, y: p.y }); p.use = 'hedge';
  } else if (r < 0.52) {
    const h = clamp(p.y - SURF - 160, 140, deep ? 520 : 300) * rr(0.8, 1);
    row(56, (x, k) => scenery.push({ type: 'kelp', x, y: p.y, h: h * (k % 2 ? 0.86 : 1), phase: k * 0.9 })); p.use = 'kelp';
  } else if (r < 0.68) {
    row(64, (x) => scenery.push({ type: 'urchin', x, y: p.y })); p.use = 'urchins';
  } else if (r < 0.84) {
    scenery.push({ type: 'coral', x: cx, y: p.y, n: 3 + Math.floor(rand() * 4) }); p.use = 'coral';
  } else if (w >= 120) {
    scenery.push({ type: 'rock', x: cx, y: p.y, w: Math.min(w - 30, rr(90, 170)), h: rr(36, 60) }); p.use = 'rock';
  }
}
const clouds = [];
for (let x = 200; x < W; x += rr(500, 900)) {
  const parts = [];
  for (let k = 0; k < 5; k++) parts.push({ dx: k * 34 - 70 + rr(-8, 8), dy: rr(-10, 10), rx: rr(40, 64), ry: rr(14, 22) });
  clouds.push({ x, y: rr(55, 110), parts });
}
const boat = { x: 760 };

// ---------- fish, swimming in formation along straight lanes ---------------------
const KINDS = [
  { body: PAL.blue, fin: PAL.yellow, mark: 'stripe', markColor: PAL.paper, len: 58 },
  { body: PAL.yellow, fin: PAL.red, mark: 'dot', markColor: PAL.ink, len: 44 },
  { body: PAL.red, fin: PAL.ink, mark: 'stripe', markColor: PAL.paper, len: 40 },
  { body: PAL.greyLight, fin: PAL.blue, mark: 'line', markColor: PAL.blue, len: 32 },
  { body: PAL.greenLight, fin: PAL.green, mark: 'dot', markColor: PAL.paper, len: 52 },
  { body: PAL.pink, fin: PAL.red, mark: 'stripe', markColor: PAL.red, len: 48 },
];
const schools = KINDS.map((kind, i) => {
  const rows = 2 + (i % 2), cols = 3 + (i % 3);
  let x, y;
  do { x = rr(400, W - 400); y = Math.round(rr(SURF + 90, groundAt(x) - 110) / 20) * 20; } while (groundAt(x) - y < 110);
  const members = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    members.push({ ox: c * kind.len * 1.5 + (r % 2) * kind.len * 0.75, oy: r * kind.len * 0.7, dx: 0, dy: 0, x: 0, y: 0 });
  }
  return { kind, x, y, dir: rand() < 0.5 ? -1 : 1, speed: rr(45, 80), members, width: cols * kind.len * 1.5, height: rows * kind.len * 0.7 };
});
function updateFish(dt, diver) {
  for (const s of schools) {
    s.x += s.dir * s.speed * dt;
    const front = s.x + s.dir * (s.width * 0.1 + 40);
    const back = s.x - s.dir * s.width;
    const blocked = (xx) => groundAt(xx) < s.y + s.height + 40 || xx < 140 || xx > W - 140;
    if (blocked(front) || blocked(s.x)) {
      s.dir *= -1; s.x = back;      // turn around: the whole formation swims back the other way
    }
    for (const m of s.members) {
      const tx = s.x - s.dir * m.ox, ty = s.y + m.oy;
      const px = tx + m.dx, py = ty + m.dy;
      const ddx = px - diver.x, ddy = py - diver.y, d = Math.hypot(ddx, ddy);
      if (d < 150 && d > 1) { m.dx += ddx / d * (150 - d) * 3 * dt; m.dy += ddy / d * (150 - d) * 3 * dt; }
      const k = Math.exp(-1.5 * dt);
      m.dx *= k; m.dy *= k;
      m.x = px; m.y = Math.min(py, groundAt(px) - 20);
    }
  }
}

// ---------- jellyfish, hung in a loose grid over the deep water ---------------
const jellies = [];
for (let i = 0; jellies.length < 12 && i < 60; i++) {
  const x = 1900 + (jellies.length * 330) + rr(-30, 30);
  const g = groundAt(x);
  if (g < 900 || x > W - 300) continue;
  const y = Math.round(lerp(SURF + 200, g - 160, rr(0.3, 0.8)) / 40) * 40;
  jellies.push({ hx: x, hy: y, x, y, s: rr(0.85, 1.25), color: pick([PAL.pink, PAL.paper, PAL.yellow]), phase: i });
}

// ---------- bubbles ---------------------------------------------------------------
const bubbles = [];
function spawnBubble(x, y, r = rr(3, 6)) {
  if (bubbles.length > 300) bubbles.shift();
  bubbles.push({ x, y, r, vy: rr(50, 80) + r * 5 });
}
function updateBubbles(dt) {
  for (const b of bubbles) b.y -= b.vy * dt;
  for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].y < SURF + 6) bubbles.splice(i, 1);
}

// =====================================================================
// Player, input, game state
// =====================================================================
const START = { x: boat.x + 140, y: SURF + 70 };
const diver = { x: START.x, y: START.y, vx: 0, vy: 0, face: 1, target: null };
const game = { state: 'menu', o2: 100, score: 0, time: 0, stingCooldown: 0, breathTimer: 2 };
const keys = new Set();

const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hudRoot'), depth: $('hDepth'), pearls: $('hPearls'), pearlsOf: $('hPearlsOf'),
  o2: $('o2'), o2Fill: $('o2Fill'), o2Val: $('o2Val'), toast: $('toast'), flash: $('flash'),
  arrow: $('sonarArrow'), sonarDist: $('sonarDist'),
  start: $('startScreen'), end: $('endScreen'),
  endTitle: $('endTitle'), endText: $('endText'), endEyebrow: $('endEyebrow'), endNum: $('endNum'),
};

let toastTimer = 0;
function toast(msg, secs = 2.2) { ui.toast.textContent = msg; ui.toast.classList.add('on'); toastTimer = secs; }

function resetGame() {
  Object.assign(diver, { x: START.x, y: START.y, vx: 0, vy: 0, face: 1, target: null });
  Object.assign(game, { o2: 100, score: 0, time: 0, stingCooldown: 0, breathTimer: 2 });
  for (const c of clams) c.taken = false;
}
function startGame() {
  resetGame();
  game.state = 'play';
  ui.start.hidden = true; ui.end.hidden = true; ui.hud.hidden = false;
  takeFocus();
  toast('Find the clams with a star above them');
}
function endGame(won) {
  game.state = 'over';
  ui.hud.hidden = true;
  ui.end.hidden = false;
  ui.endNum.textContent = String(game.score);
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

// Arrow keys. The page may sit inside another page (an embed or viewer), so the canvas takes
// keyboard focus whenever the dive starts or the scene is clicked, and key names are normalised.
const ARROW_NAMES = { ArrowUp: 'up', Up: 'up', ArrowDown: 'down', Down: 'down', ArrowLeft: 'left', Left: 'left', ArrowRight: 'right', Right: 'right' };
canvas.tabIndex = 0;
function takeFocus() { try { window.focus(); canvas.focus({ preventScroll: true }); } catch (e) { /* not focusable here */ } }
function onKey(e, down) {
  const dir = ARROW_NAMES[e.key] || ARROW_NAMES[e.code];
  if (!dir) return;
  e.preventDefault();
  if (down) { keys.add(dir); diver.target = null; } // taking the keys cancels a click-to-swim
  else keys.delete(dir);
}
document.addEventListener('keydown', (e) => onKey(e, true), true);
document.addEventListener('keyup', (e) => onKey(e, false), true);
window.addEventListener('blur', () => keys.clear());

// On-screen arrows: press and hold with the mouse or a finger.
const pad = new Set();
for (const btn of document.querySelectorAll('[data-dir]')) {
  const dir = btn.dataset.dir;
  const on = (e) => { e.preventDefault(); pad.add(dir); diver.target = null; btn.classList.add('on'); takeFocus(); };
  const off = () => { pad.delete(dir); btn.classList.remove('on'); };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointerleave', off);
  btn.addEventListener('pointercancel', off);
}
const held = (dir) => keys.has(dir) || pad.has(dir);

// click (or tap) anywhere in the water to swim there; click a clam to swim to it
canvas.addEventListener('pointerdown', (e) => {
  if (game.state !== 'play') return;
  takeFocus();
  const wx = view.x + e.clientX / view.scale, wy = view.y + e.clientY / view.scale;
  const clam = clams.find((c) => !c.taken && Math.hypot(c.x - wx, c.y - 30 - wy) < 70);
  if (clam) diver.target = { x: clam.x, y: clam.y - 40 };
  else diver.target = { x: wx, y: clamp(wy, SURF + 20, groundAt(wx) - 34) };
});

// ---------- player update -------------------------------------------------
function updateDiver(dt) {
  let ix = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
  let iy = (held('down') ? 1 : 0) - (held('up') ? 1 : 0);
  if (diver.target) {
    const dx = diver.target.x - diver.x, dy = diver.target.y - diver.y, d = Math.hypot(dx, dy);
    if (d < 20) diver.target = null;
    else {
      ix = dx / d; iy = dy / d;
      // climb over a step that is in the way
      if (groundAt(diver.x + Math.sign(dx) * 50) - 34 < diver.y + 4) iy = -1;
    }
  }
  const l = Math.hypot(ix, iy);
  if (l > 1) { ix /= l; iy /= l; }
  diver.vx += ix * 900 * dt; diver.vy += iy * 900 * dt;
  const drag = Math.exp(-2.6 * dt);
  diver.vx *= drag; diver.vy *= drag;
  diver.vy += 12 * dt;                             // a little negative buoyancy
  const nx = clamp(diver.x + diver.vx * dt, 120, W - 120);
  const edge = nx + Math.sign(diver.vx) * 40;       // the diver's nose or fins
  if (groundAt(edge) - 30 < diver.y) diver.vx = 0;  // a step face blocks the way
  else diver.x = nx;
  diver.y += diver.vy * dt;
  const floor = Math.min(groundAt(diver.x - 30), groundAt(diver.x + 30)) - 30;
  if (diver.y > floor) { diver.y = floor; diver.vy = Math.min(diver.vy, 0); }
  if (diver.y < SURF + 14) { diver.y = SURF + 14; diver.vy = Math.max(diver.vy, 0); }
  if (Math.abs(diver.vx) > 20) diver.face = Math.sign(diver.vx);

  // air
  const depth = (diver.y - SURF) / UNITS_PER_M;
  if (diver.y < SURF + 34) {
    if (game.o2 < 99) toast('Breathing', 0.6);
    game.o2 = Math.min(100, game.o2 + 30 * dt);
  } else {
    game.o2 -= (0.9 + depth * 0.03) * dt;
    game.breathTimer -= dt;
    if (game.breathTimer <= 0) {
      game.breathTimer = rr(3, 4.2);
      for (let i = 0; i < 6; i++) spawnBubble(diver.x + diver.face * 40 + rr(-5, 5), diver.y - 14 - i * 9, rr(2.5, 5));
    }
  }
  if (game.o2 <= 0) { game.o2 = 0; endGame(false); }
}

function updateInteractions(dt) {
  game.stingCooldown -= dt;
  for (const j of jellies) {
    if (Math.hypot(j.x - diver.x, j.y + 20 * j.s - diver.y) < 36 * j.s + 26 && game.stingCooldown <= 0) {
      game.stingCooldown = 1.5;
      game.o2 = Math.max(0, game.o2 - 12);
      const dx = diver.x - j.x, dy = diver.y - j.y, d = Math.hypot(dx, dy) || 1;
      diver.vx += dx / d * 260; diver.vy += dy / d * 260;
      diver.target = null;
      ui.flash.classList.add('on');
      requestAnimationFrame(() => requestAnimationFrame(() => ui.flash.classList.remove('on')));
      toast('Stung! −12% air');
    }
  }
  let nearest = null, nd = Infinity;
  for (const c of clams) {
    if (c.taken) continue;
    const d = Math.hypot(c.x - diver.x, c.y - 30 - diver.y);
    if (d < 70) {
      c.taken = true;
      game.score++;
      game.o2 = Math.min(100, game.o2 + 10);
      for (let i = 0; i < 10; i++) spawnBubble(c.x + rr(-16, 16), c.y - 20 - i * 6, rr(2, 4));
      toast(game.score === clams.length ? 'Last pearl!' : `Pearl ${game.score} of ${clams.length} · +10% air`);
      if (game.score === clams.length) setTimeout(() => endGame(true), 900);
    } else if (d < nd) { nd = d; nearest = c; }
  }
  if (nearest) {
    const ang = Math.atan2(nearest.x - diver.x, -(nearest.y - 30 - diver.y)) * 180 / Math.PI;
    ui.arrow.setAttribute('transform', `rotate(${ang.toFixed(1)})`);
    ui.sonarDist.innerHTML = `${Math.round(nd / UNITS_PER_M)}<small>m</small>`;
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
  ui.depth.innerHTML = `${Math.round(depth)}<small>m</small>`;
  ui.pearls.textContent = String(game.score);
  ui.pearlsOf.textContent = `of ${clams.length}`;
  ui.o2Fill.style.transform = `scaleX(${(game.o2 / 100).toFixed(3)})`;
  ui.o2Val.textContent = `${Math.ceil(game.o2)}%`;
  ui.o2.classList.toggle('low', game.o2 < 25);
}

// =====================================================================
// Drawing: flat fills, thin ink lines, everything straight on
// =====================================================================
const INK_W = 1.6;
function ink(w = INK_W) { ctx.strokeStyle = PAL.ink; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }

function drawSplat(x, y, r, color, rot) {
  // a paint-splat star: eight uneven points
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
function drawClam(c, frame) {
  const { x, y } = c;
  ink();
  if (c.taken) {
    ctx.fillStyle = PAL.paper;
    ctx.beginPath(); ctx.arc(x, y, 26, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    for (const a of [0.2, 0.4, 0.6, 0.8]) { const t = Math.PI + a * Math.PI; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(t) * 26, y + Math.sin(t) * 26); ctx.stroke(); }
    return;
  }
  // lower shell as a tray, lid raised, pearl between
  ctx.fillStyle = PAL.paper;
  ctx.beginPath(); ctx.moveTo(x - 26, y - 8); ctx.lineTo(x + 26, y - 8); ctx.lineTo(x + 20, y); ctx.lineTo(x - 20, y); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y - 26, 26, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  for (const a of [0.2, 0.4, 0.6, 0.8]) { const t = Math.PI + a * Math.PI; ctx.beginPath(); ctx.moveTo(x, y - 26); ctx.lineTo(x + Math.cos(t) * 26, y - 26 + Math.sin(t) * 26); ctx.stroke(); }
  ctx.fillStyle = PAL.white;
  ctx.beginPath(); ctx.arc(x, y - 16, 7, 0, 7); ctx.fill(); ctx.stroke();
  drawSplat(x, y - 74, 15, c.color, (frame % 8) * (Math.PI / 16) + c.phase);
}
function drawKelp(s, st) {
  const lean = Math.sin(st * 0.9 + s.phase) * 10;
  const topX = s.x + lean, topY = s.y - s.h;
  ctx.strokeStyle = PAL.greenDark; ctx.lineWidth = 3; ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(topX, topY); ctx.stroke();
  ctx.fillStyle = PAL.green;
  for (let y = 26, k = 0; y < s.h - 6; y += 24, k++) {
    const u = y / s.h, px = s.x + lean * u, py = s.y - y, side = k % 2 ? 1 : -1;
    ctx.save(); ctx.translate(px, py); ctx.rotate(side * -0.6);
    ctx.beginPath(); ctx.ellipse(side * 13, 0, 13, 5, 0, 0, 7); ctx.fill();
    ctx.restore();
  }
  ctx.beginPath(); ctx.ellipse(topX, topY - 6, 5, 9, 0, 0, 7); ctx.fill();
}
function drawUrchin(x, y) {
  ink(1.2);
  for (let i = 0; i < 18; i++) {
    const a = Math.PI + (i / 17) * Math.PI;
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 10, y - 10 + Math.sin(a) * 10); ctx.lineTo(x + Math.cos(a) * 24, y - 10 + Math.sin(a) * 24); ctx.stroke();
  }
  ctx.fillStyle = PAL.ink;
  ctx.beginPath(); ctx.arc(x, y - 10, 12, 0, 7); ctx.fill();
}
function drawCoral(s) {
  // organ-pipe coral: a row of red tubes of stepped heights
  const n = s.n, gap = 16, x0 = s.x - ((n - 1) * gap) / 2;
  for (let k = 0; k < n; k++) {
    const h = 40 + ((k * 37 + n * 11) % 5) * 14;
    const x = x0 + k * gap;
    ctx.fillStyle = PAL.red;
    ctx.beginPath(); ctx.roundRect(x - 6, s.y - h, 12, h, [6, 6, 0, 0]); ctx.fill();
    ctx.fillStyle = PAL.ink;
    ctx.beginPath(); ctx.ellipse(x, s.y - h + 5, 3.5, 2, 0, 0, 7); ctx.fill();
  }
}
function drawRock(s) {
  ctx.fillStyle = TEX.rock;
  ctx.beginPath(); ctx.roundRect(s.x - s.w / 2, s.y - s.h, s.w, s.h, [18, 18, 0, 0]); ctx.fill();
}
function drawHedge(s) {
  ctx.fillStyle = TEX.hedge;
  ctx.fillRect(s.x0, s.y - 30, s.x1 - s.x0, 30);
  ink(1.4);
  for (let x = s.x0 + 14; x < s.x1 - 8; x += 28) {   // small v marks along the base, like a planted border
    ctx.beginPath(); ctx.moveTo(x - 4, s.y - 6); ctx.lineTo(x, s.y - 1); ctx.lineTo(x + 4, s.y - 6); ctx.stroke();
  }
}
function drawVent(s, st) {
  const x = s.x, y = s.y;
  ctx.fillStyle = PAL.brick;
  ctx.fillRect(x - 22, y - 80, 44, 80);
  ink(1);
  for (let r = 1; r < 8; r++) {
    const yy = y - r * 10;
    ctx.beginPath(); ctx.moveTo(x - 22, yy); ctx.lineTo(x + 22, yy); ctx.stroke();
    for (let c = (r % 2 ? -11 : -22); c < 22; c += 22) { ctx.beginPath(); ctx.moveTo(x + c, yy); ctx.lineTo(x + c, yy + 10); ctx.stroke(); }
  }
  // flame-shaped plume on top, flipping between two drawings
  ctx.fillStyle = PAL.red;
  ctx.beginPath(); ctx.moveTo(x - 22, y - 80);
  const alt = Math.floor(st * 3) % 2;
  for (let k = 0; k <= 6; k++) ctx.lineTo(x - 22 + k * 7.3, y - 80 - (k % 2 === alt ? 16 : 5));
  ctx.lineTo(x + 22, y - 80); ctx.closePath(); ctx.fill();
}
function drawStarfish(x, y) {
  ctx.fillStyle = PAL.red;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 4 : 11; ctx.lineTo(x + Math.cos(a) * r, y - 8 + Math.sin(a) * r * 0.7); }
  ctx.closePath(); ctx.fill();
}
function drawPole(p) {
  const x = p.x, bottom = groundAt(x), top = SURF - 150;
  ctx.fillStyle = PAL.brown;
  ctx.fillRect(x - 5, top, 10, bottom - top);
  ctx.fillRect(x - 34, top + 16, 68, 6);
  ctx.fillStyle = PAL.greyLight; ctx.fillRect(x - 30, top + 6, 6, 10); ctx.fillRect(x + 24, top + 6, 6, 10);
  // a rung every metre, a numbered plate every five
  ctx.font = '500 13px Jost, Futura, "Century Gothic", sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (let m = 1; SURF + m * UNITS_PER_M < bottom - 6; m++) {
    const y = SURF + m * UNITS_PER_M, side = m % 2 ? 1 : -1;
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(side > 0 ? x + 5 : x - 13, y - 1, 8, 2.5);
    if (m % 5 === 0) {
      ctx.fillStyle = PAL.paper; ctx.fillRect(x + 12, y - 9, 34, 18);
      ink(1.2); ctx.strokeRect(x + 12, y - 9, 34, 18);
      ctx.fillStyle = PAL.ink; ctx.fillText(`${m} m`, x + 15, y + 1);
    }
  }
}
function drawBoat(st) {
  const x = boat.x, y = SURF + (Math.floor(st * 2) % 2 ? 1.5 : 0);
  ctx.fillStyle = PAL.red;
  ctx.beginPath(); ctx.moveTo(x - 120, y - 16); ctx.lineTo(x + 120, y - 16); ctx.lineTo(x + 96, y + 20); ctx.lineTo(x - 96, y + 20); ctx.closePath(); ctx.fill();
  ctx.fillStyle = PAL.paper; ctx.fillRect(x - 120, y - 20, 240, 5);
  // cabin with a grid of window panes
  ctx.fillStyle = PAL.cream; ctx.fillRect(x - 60, y - 70, 110, 50);
  ctx.fillStyle = PAL.brown; ctx.fillRect(x - 68, y - 78, 126, 9);
  ink(1.2);
  for (const wx of [x - 48, x - 8]) {
    ctx.fillStyle = PAL.white; ctx.fillRect(wx, y - 60, 30, 26); ctx.strokeRect(wx, y - 60, 30, 26);
    ctx.fillStyle = PAL.ink; ctx.fillRect(wx + 14, y - 60, 2, 26); ctx.fillRect(wx, y - 48, 30, 2);
  }
  ctx.fillStyle = PAL.brown; ctx.fillRect(x + 70, y - 130, 5, 114);
  ctx.fillStyle = PAL.yellow; ctx.fillRect(x + 75, y - 128, 26, 16);
  // anchor line straight down
  ctx.setLineDash([6, 6]); ink(1.2);
  ctx.beginPath(); ctx.moveTo(x - 90, y + 14); ctx.lineTo(x - 90, groundAt(x - 90) - 8); ctx.stroke();
  ctx.setLineDash([]);
}
function drawPlane(t) {
  const x = ((t * 22) % (W + 400)) - 200, y = 44;
  ctx.fillStyle = PAL.ink;
  ctx.beginPath(); ctx.ellipse(x, y, 30, 4.5, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x - 16, y - 14); ctx.lineTo(x - 8, y - 14); ctx.lineTo(x + 8, y); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 24, y); ctx.lineTo(x - 32, y - 10); ctx.lineTo(x - 27, y - 10); ctx.lineTo(x - 18, y); ctx.fill();
}
function drawFish(x, y, kind, face, flick) {
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
  ctx.fillStyle = PAL.white; ctx.beginPath(); ctx.arc(L * 0.24, -h * 0.1, h * 0.17, 0, 7); ctx.fill();
  ctx.fillStyle = PAL.ink; ctx.beginPath(); ctx.arc(L * 0.26, -h * 0.1, h * 0.09, 0, 7); ctx.fill();
  ctx.restore();
}
function drawJelly(j) {
  const r = 22 * j.s;
  ink(1.3);
  for (let k = -2; k <= 2; k++) {
    const len = (k % 2 ? 36 : 48) * j.s;
    ctx.beginPath(); ctx.moveTo(j.x + k * r * 0.36, j.y); ctx.lineTo(j.x + k * r * 0.36, j.y + len); ctx.stroke();
  }
  ctx.fillStyle = j.color;
  ctx.beginPath(); ctx.arc(j.x, j.y, r, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(j.x - r * 0.7, j.y - r * 0.35); ctx.lineTo(j.x + r * 0.7, j.y - r * 0.35); ctx.stroke();
}
function drawDiver(frame, moving) {
  const k = moving ? (frame % 2 ? 1 : -1) : 0;          // flipper kick, a flip-book beat
  ctx.save();
  ctx.translate(diver.x, diver.y);
  ctx.scale(diver.face, 1);
  // legs and flippers
  for (const [oy, swing] of [[-3, 0.1 + k * 0.15], [4, -0.06 - k * 0.15]]) {
    ctx.save(); ctx.translate(-26, oy); ctx.rotate(swing);
    ctx.fillStyle = PAL.ink; ctx.fillRect(-34, -4, 36, 8);
    ctx.beginPath(); ctx.moveTo(-32, -3); ctx.lineTo(-56, -12); ctx.lineTo(-54, 8); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // tank
  ctx.fillStyle = PAL.greyLight; ctx.fillRect(-26, -22, 40, 11);
  ink(1.2); ctx.strokeRect(-26, -22, 40, 11);
  // body in a red suit
  ctx.fillStyle = PAL.red;
  ctx.beginPath(); ctx.roundRect(-30, -11, 58, 22, 10); ctx.fill();
  ctx.fillStyle = PAL.ink; ctx.fillRect(-6, -11, 3, 22);
  // arm
  ctx.save(); ctx.translate(16, 4); ctx.rotate(0.3 - k * 0.1); ctx.fillStyle = PAL.red; ctx.fillRect(0, -3.5, 22, 7);
  ctx.fillStyle = PAL.cream; ctx.beginPath(); ctx.arc(24, 0, 4.5, 0, 7); ctx.fill(); ctx.restore();
  // head, hood and mask
  ctx.fillStyle = PAL.cream; ctx.beginPath(); ctx.arc(36, -6, 11, 0, 7); ctx.fill();
  ctx.fillStyle = PAL.ink; ctx.beginPath(); ctx.arc(34, -8, 11.5, Math.PI * 0.9, Math.PI * 1.95); ctx.closePath(); ctx.fill();
  ctx.fillStyle = PAL.blue; ctx.fillRect(38, -12, 11, 8);
  ink(1.2); ctx.strokeRect(38, -12, 11, 8);
  ctx.restore();
}

function render(t, frame, st) {
  const dpr = view.dpr, sc = view.scale;
  ctx.setTransform(dpr * sc, 0, 0, dpr * sc, -view.x * dpr * sc, -view.y * dpr * sc);
  const x0 = view.x - 30, x1 = view.x + view.w + 30, yb = view.y + view.h + 30;

  // sky, stippled clouds, a plane
  if (view.y < SURF) {
    ctx.fillStyle = PAL.sky;
    ctx.fillRect(x0, view.y - 10, x1 - x0, SURF - view.y + 10);
    ctx.fillStyle = TEX.cloud;
    for (const c of clouds) {
      if (c.x < x0 - 200 || c.x > x1 + 200) continue;
      ctx.beginPath();
      for (const p of c.parts) { ctx.moveTo(c.x + p.dx + p.rx, c.y + p.dy); ctx.ellipse(c.x + p.dx, c.y + p.dy, p.rx, p.ry, 0, 0, 7); }
      ctx.fill();
    }
    drawPlane(t);
  }

  // water in straight bands, ruled like siding
  for (let k = 0; k < WATER.length; k++) {
    const top = SURF + k * WATER_BAND, bot = k === WATER.length - 1 ? H + 40 : top + WATER_BAND;
    if (bot < view.y || top > yb) continue;
    ctx.fillStyle = WATER[k];
    ctx.fillRect(x0, top, x1 - x0, bot - top);
  }
  ctx.fillStyle = 'rgba(30, 60, 80, 0.07)';
  for (let y = SURF + 22; y < Math.min(yb, H); y += 22) if (y > view.y - 2) ctx.fillRect(x0, y, x1 - x0, 1.2);
  ink(1.4);
  ctx.beginPath(); ctx.moveTo(x0, SURF); ctx.lineTo(x1, SURF); ctx.stroke();

  for (const p of poles) if (p.x > x0 - 60 && p.x < x1 + 60) drawPole(p);

  // the stepped seabed
  const c0 = clamp(Math.floor(x0 / COL), 0, NCOL - 1), c1 = clamp(Math.ceil(x1 / COL), 0, NCOL - 1);
  const stairs = () => {
    ctx.beginPath();
    ctx.moveTo(c0 * COL, H + 40);
    for (let i = c0; i <= c1; i++) { ctx.lineTo(i * COL, steps[i]); ctx.lineTo((i + 1) * COL, steps[i]); }
    ctx.lineTo((c1 + 1) * COL, H + 40); ctx.closePath();
  };
  stairs(); ctx.fillStyle = PAL.cream; ctx.fill();
  ctx.save(); stairs(); ctx.clip();
  ctx.fillStyle = 'rgba(120, 100, 70, 0.14)';
  for (let y = Math.floor(view.y / RISE) * RISE + RISE; y < yb; y += RISE) ctx.fillRect(x0, y + 12, x1 - x0, 1.2);
  ctx.setLineDash([3, 5]); ctx.strokeStyle = 'rgba(120, 100, 70, 0.3)'; ctx.lineWidth = 1;
  for (let i = c0; i <= c1 + 1; i++) { ctx.beginPath(); ctx.moveTo(i * COL, steps[clamp(i, 0, NCOL - 1)] + 12); ctx.lineTo(i * COL, yb); ctx.stroke(); }
  ctx.setLineDash([]);
  // a beige tread band just under each step's top edge
  ctx.fillStyle = PAL.beige;
  for (let i = c0; i <= c1; i++) ctx.fillRect(i * COL, steps[i], COL, 8);
  ctx.restore();
  ink(1.4);
  ctx.beginPath();
  for (let i = c0; i <= c1; i++) { ctx.lineTo(i * COL, steps[i]); ctx.lineTo((i + 1) * COL, steps[i]); }
  ctx.stroke();

  // things on the steps
  for (const s of scenery) {
    const sx = s.x ?? s.x0;
    if (sx < x0 - 200 || sx > x1 + 200) continue;
    if (s.type === 'kelp') drawKelp(s, st);
    else if (s.type === 'urchin') drawUrchin(s.x, s.y);
    else if (s.type === 'coral') drawCoral(s);
    else if (s.type === 'rock') drawRock(s);
    else if (s.type === 'hedge') drawHedge(s);
    else if (s.type === 'vent') drawVent(s, st);
    else if (s.type === 'star') drawStarfish(s.x, s.y);
  }
  for (const c of clams) if (c.x > x0 - 60 && c.x < x1 + 60) drawClam(c, frame);

  // creatures
  for (const j of jellies) if (j.x > x0 - 60 && j.x < x1 + 60) drawJelly(j);
  for (const s of schools) {
    const flick = frame % 2 ? 2 : -2;
    for (const m of s.members) if (m.x > x0 - 60 && m.x < x1 + 60) drawFish(m.x, m.y, s.kind, s.dir, flick);
  }
  if (game.state === 'play') drawDiver(frame, Math.hypot(diver.vx, diver.vy) > 40);
  ink(1.1);
  ctx.fillStyle = PAL.white;
  for (const b of bubbles) {
    if (b.x < x0 || b.x > x1) continue;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); ctx.stroke();
  }
  if (diver.target && game.state === 'play') {
    ink(1.4);
    const { x, y } = diver.target;
    ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7); ctx.stroke();
  }
  drawBoat(st);

  // pencil grain over everything, fixed to the screen like the page itself
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = grain;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ---------- camera ---------------------------------------------------------
function updateCamera(dt, tx, ty) {
  const cx = clamp(tx - view.w / 2, 0, Math.max(0, W - view.w));
  const cy = clamp(ty - view.h * 0.45, -20, Math.max(-20, H - view.h));
  const k = Math.min(1, dt * 3);
  view.x = lerp(view.x, cx, k);
  view.y = lerp(view.y, cy, k);
}

// ---------- main loop ---------------------------------------------------------
let last = performance.now(), t = 0, ventTimer = 0, menuX = 900;
resetGame();
view.x = clamp(diver.x - view.w / 2, 0, W - view.w);
view.y = clamp(diver.y - view.h * 0.45, -20, H - view.h);

function frameLoop(now) {
  const dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;
  if (!document.hidden) t += dt;
  const frame = Math.floor(t * STEP_FPS);
  const st = frame / STEP_FPS;                         // flip-book time for ambient motion

  if (game.state === 'play') {
    game.time += dt;
    updateDiver(dt);
    updateInteractions(dt);
    updateHUD(dt);
    updateCamera(dt, diver.x, diver.y);
  } else {
    // drift slowly along the lagoon behind the menu
    menuX += dt * 40;
    if (menuX > W - 700) menuX = 900;
    updateCamera(dt, menuX, SURF + 300);
  }
  updateFish(dt, game.state === 'play' ? diver : { x: -9999, y: -9999 });
  for (const j of jellies) { j.x = j.hx; j.y = j.hy + (frame % 4 < 2 ? -5 : 5); }
  ventTimer -= dt;
  if (ventTimer <= 0) {
    ventTimer = 0.35;
    for (const v of vents) spawnBubble(v.x + rr(-10, 10), v.y, rr(3, 6));
  }
  updateBubbles(dt);
  render(t, frame, st);
  requestAnimationFrame(frameLoop);
}
requestAnimationFrame(frameLoop);

// exposed for tinkering from the console
window.blueHollow = { diver, game, clams, jellies, schools, groundAt };
