// =====================================================================
// Deep House: a dive through a flooded house, seen as a cut-open elevation.
// Flat colour, thin ink lines, things set out in rows. The attic still has
// a pocket of air under the roof; everything below it is under water.
// Arrow keys (or the on-screen pad) swim; clicking swims you to a spot.
// =====================================================================

const W = 2600, H = 1900;               // world size
const WL = 470;                         // water line inside the attic
const UNITS_PER_M = 40;
const STEP_FPS = 6;                     // ambient motion moves in small flip-book steps
const GROUND = 1700;                    // lawn level outside

// ---------- seeded random ----------------------------------------------
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
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- palette ---------------------------------------------------
const PAL = {
  sky: '#bcd2e8', lawn: '#4a9660', paper: '#f4efe3', siding: '#e6ddc8', sidingLine: '#cfc4a8',
  roof: '#6b5a4e', roofLine: '#56483e', trim: '#d6a39b', ink: '#1e1e1e', red: '#e2552d', blue: '#2e62b0',
  green: '#2f8f4e', mint: '#8fcaa6', pink: '#e8b4ad', yellow: '#e8c547', grey: '#9b9b9b', greyLight: '#cdcac3',
  brown: '#6b4a3a', wood: '#a67a55', white: '#ffffff', cream: '#efe7d3',
};
const WATER_TINT = 'rgba(70, 130, 185, 0.2)';

// ---------- the house -------------------------------------------------------
// Rooms are interiors; walls and floors are solid; doorways and hatches are gaps.
const ROOMS = [
  { id: 'attic', x0: 224, x1: 2376, y0: 400, y1: 700, paper: '#dccdb0', pattern: 'planks', line: '#cbb996' },
  { id: 'parlor', x0: 224, x1: 1100, y0: 724, y1: 1024, paper: '#efdcd2', pattern: 'stripes', line: '#e2c7bb' },
  { id: 'kitchen', x0: 1118, x1: 2376, y0: 724, y1: 1024, paper: '#e3ead8', pattern: 'checks', line: '#d2dcc3' },
  { id: 'bath', x0: 224, x1: 800, y0: 1048, y1: 1348, paper: '#dbe7ec', pattern: 'tiles', line: '#c4d5dc' },
  { id: 'class', x0: 818, x1: 1800, y0: 1048, y1: 1348, paper: '#f1ead8', pattern: 'dado', line: PAL.blue },
  { id: 'bed', x0: 1818, x1: 2376, y0: 1048, y1: 1348, paper: '#ebe0e8', pattern: 'dots', line: '#d9c5d6' },
  { id: 'cellar', x0: 224, x1: 1300, y0: 1372, y1: 1672, paper: '#d6d1c6', pattern: 'bricks', line: '#c2bbad' },
  { id: 'hall', x0: 1318, x1: 2376, y0: 1372, y1: 1672, paper: '#ebe4d2', pattern: 'plain', line: '#ddd4bd' },
];
const room = Object.fromEntries(ROOMS.map((r) => [r.id, r]));
const SLABS = [   // floor/ceiling slabs with a hatch in each
  { y: 700, hatch: [1920, 2080] },
  { y: 1024, hatch: [560, 720] },
  { y: 1348, hatch: [1560, 1720] },
];
const WALLS = [   // interior walls with a doorway at the bottom
  { x: 1100, y0: 724, y1: 1024 },
  { x: 800, y0: 1048, y1: 1348 },
  { x: 1800, y0: 1048, y1: 1348 },
  { x: 1300, y0: 1372, y1: 1672 },
];
const DOOR_H = 150;
const solids = [
  { x: 0, y: 0, w: W, h: 400 },                  // roof and everything above the attic
  { x: 0, y: 0, w: 224, h: H },                  // outside the left wall
  { x: 2376, y: 0, w: W - 2376, h: H },          // outside the right wall
  { x: 0, y: 1672, w: W, h: H - 1672 },          // foundation
];
for (const s of SLABS) {
  solids.push({ x: 224, y: s.y, w: s.hatch[0] - 224, h: 24 });
  solids.push({ x: s.hatch[1], y: s.y, w: 2376 - s.hatch[1], h: 24 });
}
for (const w of WALLS) solids.push({ x: w.x, y: w.y0, w: 18, h: w.y1 - w.y0 - DOOR_H });
const hits = (x, y, hw, hh) => solids.some((s) => x + hw > s.x && x - hw < s.x + s.w && y + hh > s.y && y - hh < s.y + s.h);
const floorAt = (x, y) => { for (const r of ROOMS) if (x >= r.x0 && x <= r.x1 && y >= r.y0 - 30 && y <= r.y1) return r.y1; return 1672; };

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
  view.scale = Math.min(ch / 760, cw / 520);
  view.w = cw / view.scale; view.h = ch / view.scale;
}
resize();
window.addEventListener('resize', resize);

// ---------- textures: sponge stipple and pencil grain ------------------------
function stipple(base, colors, count, size = 96, rMin = 0.5, rMax = 1.2, seed = 3) {
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
  lawn: stipple(PAL.lawn, ['#3d8653', '#5aa56d', '#77b986', '#2f7a47'], 1800, 96, 0.5, 1.2, 4),
  cloud: stipple(null, ['#a8a8a8', '#d0d0d0', '#f0f0f0', '#ffffff'], 1800, 96, 0.4, 1.0, 5),
  plant: stipple(PAL.green, ['#256f3e', '#43a062', '#6cbf80'], 900, 64, 0.5, 1.1, 7),
};
const grain = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  const r = mulberry32(9);
  for (let i = 0; i < 2000; i++) { const v = 215 + Math.floor(r() * 40); g.fillStyle = `rgb(${v},${v},${v - 4})`; g.fillRect(r() * 256, r() * 256, 1, 1); }
  g.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const v = 225 + Math.floor(r() * 28); g.strokeStyle = `rgb(${v},${v},${v - 3})`; g.lineWidth = 0.7;
    const x = r() * 256, y = r() * 256, l = 5 + r() * 12;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + l * 0.6, y - l); g.stroke();
  }
  return ctx.createPattern(c, 'repeat');
})();

// =====================================================================
// Furnishing the house
// =====================================================================
const things = [];   // furniture, drawn in order
const add = (type, props) => { const t = { type, ...props }; things.push(t); return t; };
const clams = [];
const clamOn = (x, y) => clams.push({ x, y, taken: false, color: [PAL.red, PAL.yellow, PAL.blue, PAL.green][clams.length % 4], phase: clams.length });

// attic: suitcases, a round window, and a long row of folding chairs; four of them hold clams
add('suitcases', { x: 300, y: 700 });
add('roundWindow', { x: 1300, y: 520 });
for (let i = 0; i < 14; i++) {
  const x = 640 + i * 82;
  add('chair', { x, y: 700, face: 1 });
  if ([1, 5, 9, 12].includes(i)) clamOn(x, 700 - 46);
}
add('hatchLadder', { x: 2000, y0: 724, y1: 1024 });
// parlor
add('painting', { x: 440, y: 830 });
add('sofa', { x: 480, y: 1024 }); clamOn(420, 1024 - 44);
add('lamp', { x: 690, y: 1024 });
add('sideTable', { x: 790, y: 1024 }); clamOn(790, 1024 - 70);
add('window', { x: 900, y: 800 });
add('clock', { x: 1020, y: 1024 });
add('plant', { x: 270, y: 1024 });
// kitchen
add('window', { x: 1260, y: 790 });
add('table', { x: 1380, y: 1024 }); clamOn(1380, 1024 - 74);
add('chair', { x: 1290, y: 1024, face: 1 }); add('chair', { x: 1470, y: 1024, face: -1 });
add('fridge', { x: 1620, y: 1024 }); clamOn(1620, 1024 - 176);
add('stove', { x: 1740, y: 1024 });
add('counter', { x0: 2130, x1: 2350, y: 1024 }); clamOn(2250, 1024 - 84);
add('shelf', { x0: 2140, x1: 2340, y: 850 });
add('hatchLadder', { x: 640, y0: 1048, y1: 1348 });
// bathroom
add('tub', { x: 350, y: 1348 }); clamOn(350, 1348 - 36);
add('mirror', { x: 540, y: 1170 });
add('sink', { x: 540, y: 1348 }); clamOn(540, 1348 - 86);
// classroom (after the primer): an easel with a blackboard, desks in a row, a green wardrobe, a hanging lamp
add('easel', { x: 930, y: 1348 });
for (let i = 0; i < 4; i++) { const x = 1140 + i * 150; add('desk', { x, y: 1348 }); clamOn(x - 12, 1348 - 62); }
add('picture', { x: 1500, y: 1140 });
add('wardrobe', { x: 1735, y: 1348 });
add('pendant', { x: 1250, y: 1048 });
add('hatchLadder', { x: 1640, y0: 1372, y1: 1672 });
// bedroom
add('bed', { x: 2010, y: 1348 }); clamOn(1935, 1348 - 70);
add('nightstand', { x: 2180, y: 1348 }); clamOn(2180, 1348 - 56);
add('window', { x: 2300, y: 1130 });
// cellar
add('boiler', { x: 330, y: 1672 });
add('boxes', { x: 560, y: 1672 }); clamOn(560, 1672 - 118);
add('washer', { x: 820, y: 1672 });
add('jars', { x0: 950, x1: 1250, y: 1520 });
// hall: an audience of folding chairs facing a red door that opens onto nothing
for (let i = 0; i < 9; i++) {
  const x = 1440 + i * 76;
  if (x > 1600 && x < 1690) continue;    // leave room for the ladder
  add('chair', { x, y: 1672, face: 1 });
  if (i === 2 || i === 7) clamOn(x, 1672 - 46);
}
add('redDoor', { x: 2270, y: 1672 });

// wall splats, like thrown paint
const splats = [];
for (const r of ROOMS) {
  const n = r.id === 'hall' || r.id === 'attic' ? 5 : 2;
  for (let i = 0; i < n; i++) splats.push({ x: rr(r.x0 + 40, r.x1 - 40), y: rr(r.y0 + 30, r.y0 + 120), r: rr(6, 10), color: [PAL.red, PAL.blue, PAL.yellow, PAL.grey][i % 4], rot: rand() * 6 });
}

// ---------- fish, swimming in formation from wall to wall ---------------------
const KINDS = [
  { body: PAL.blue, fin: PAL.yellow, mark: 'stripe', markColor: PAL.paper, len: 46 },
  { body: PAL.yellow, fin: PAL.red, mark: 'dot', markColor: PAL.ink, len: 36 },
  { body: PAL.red, fin: PAL.ink, mark: 'stripe', markColor: PAL.paper, len: 34 },
  { body: PAL.greyLight, fin: PAL.blue, mark: 'line', markColor: PAL.blue, len: 28 },
  { body: PAL.mint, fin: PAL.green, mark: 'dot', markColor: PAL.paper, len: 40 },
  { body: PAL.pink, fin: PAL.red, mark: 'stripe', markColor: PAL.red, len: 38 },
];
const LANES = [['attic', 570], ['parlor', 880], ['kitchen', 860], ['class', 1150], ['hall', 1470], ['cellar', 1440]];
const schools = LANES.map(([id, y], i) => {
  const r = room[id], kind = KINDS[i], rows = 2 + (i % 2), cols = 3 + (i % 2);
  const members = [];
  for (let a = 0; a < rows; a++) for (let c = 0; c < cols; c++) members.push({ ox: c * kind.len * 1.5 + (a % 2) * kind.len * 0.75, oy: a * kind.len * 0.75, dx: 0, dy: 0, x: 0, y: 0 });
  const width = cols * kind.len * 1.5;
  return { kind, room: r, y, x: rr(r.x0 + width + 40, r.x1 - 60), dir: rand() < 0.5 ? -1 : 1, speed: rr(35, 60), members, width };
});
function updateFish(dt, diver) {
  for (const s of schools) {
    s.x += s.dir * s.speed * dt;
    if (s.dir > 0 && s.x > s.room.x1 - 40) { s.dir = -1; s.x = s.room.x1 - 40 - s.width; }
    if (s.dir < 0 && s.x < s.room.x0 + 40) { s.dir = 1; s.x = s.room.x0 + 40 + s.width; }
    for (const m of s.members) {
      const px = s.x - s.dir * m.ox + m.dx, py = s.y + m.oy + m.dy;
      const ddx = px - diver.x, ddy = py - diver.y, d = Math.hypot(ddx, ddy);
      if (d < 130 && d > 1) { m.dx += ddx / d * (130 - d) * 3 * dt; m.dy += ddy / d * (130 - d) * 3 * dt; }
      const k = Math.exp(-1.5 * dt);
      m.dx *= k; m.dy *= k;
      m.x = clamp(px, s.room.x0 + 20, s.room.x1 - 20);
      m.y = clamp(py, Math.max(s.room.y0 + 16, WL + 12), s.room.y1 - 16);
    }
  }
}

// ---------- jellyfish ----------------------------------------------------------
const jellies = [[1990, 1150], [2250, 1210], [720, 1470], [1080, 1450], [1950, 1450]].map(([x, y], i) => (
  { hx: x, hy: y, x, y, s: rr(0.8, 1.1), color: [PAL.pink, PAL.paper, PAL.yellow][i % 3] }));

// ---------- bubbles ---------------------------------------------------------------
const bubbles = [];
function spawnBubble(x, y, r = rr(2.5, 5)) {
  if (bubbles.length > 200) bubbles.shift();
  bubbles.push({ x, y, r, vy: rr(45, 75) + r * 5, top: 0 });
}
function updateBubbles(dt) {
  for (const b of bubbles) {
    b.y -= b.vy * dt;
    if (hits(b.x, b.y, 1, 1) || b.y < WL + 4) b.dead = true;   // pop against ceilings and at the surface
  }
  for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].dead) bubbles.splice(i, 1);
}

// =====================================================================
// Player, input, game state
// =====================================================================
const HW = 30, HH = 12;   // the diver's collision box
const START = { x: 520, y: WL + 18 };
const diver = { x: START.x, y: START.y, vx: 0, vy: 0, face: 1, target: null };
const game = { state: 'menu', o2: 100, score: 0, time: 0, stingCooldown: 0, breathTimer: 2 };
const keys = new Set();

const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hudRoot'), depth: $('hDepth'), pearls: $('hPearls'), pearlsOf: $('hPearlsOf'),
  o2: $('o2'), o2Fill: $('o2Fill'), o2Val: $('o2Val'), toast: $('toast'), flash: $('flash'),
  arrow: $('sonarArrow'), sonarDist: $('sonarDist'), focusHint: $('focusHint'),
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
      best = Number(localStorage.getItem('deepHouseBest')) || null;
      if (!best || game.time < best) localStorage.setItem('deepHouseBest', String(game.time));
    } catch (e) { /* storage unavailable */ }
    const record = !best || game.time < best;
    ui.endEyebrow.textContent = record ? 'New best time' : 'Dive log';
    ui.endTitle.textContent = 'Every pearl found';
    ui.endText.textContent = `You cleared the house in ${mins}:${secs}` +
      (best && !record ? `. Your best is ${Math.floor(best / 60)}:${Math.floor(best % 60).toString().padStart(2, '0')}.` : '.');
  } else {
    ui.endEyebrow.textContent = 'Dive log';
    ui.endTitle.textContent = 'Out of air';
    ui.endText.textContent = `You found ${game.score} of ${clams.length} pearls in ${mins}:${secs}. Swim back up to the attic to breathe sooner next time.`;
  }
}
$('startBtn').addEventListener('click', startGame);
$('restartBtn').addEventListener('click', startGame);

// Arrow keys. Inside a viewer or embed, the page only hears keys while it has focus, so it takes
// focus whenever the dive starts or the house is clicked, and shows a hint when focus is elsewhere.
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
for (const target of [window, document]) {
  target.addEventListener('keydown', (e) => onKey(e, true), true);
  target.addEventListener('keyup', (e) => onKey(e, false), true);
}
window.addEventListener('blur', () => keys.clear());

// On-screen arrows: press and hold with the mouse or a finger.
const pad = new Set();
for (const btn of document.querySelectorAll('[data-dir]')) {
  const dir = btn.dataset.dir;
  const on = (e) => { e.preventDefault(); pad.add(dir); diver.target = null; btn.classList.add('on'); takeFocus(); };
  const off = () => { pad.delete(dir); btn.classList.remove('on'); };
  btn.addEventListener('pointerdown', on);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, off);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}
const held = (dir) => keys.has(dir) || pad.has(dir);

// click (or tap) anywhere to swim there; click a clam to swim to it
canvas.addEventListener('pointerdown', (e) => {
  if (game.state !== 'play') return;
  takeFocus();
  const wx = view.x + e.clientX / view.scale, wy = view.y + e.clientY / view.scale;
  const clam = clams.find((c) => !c.taken && Math.hypot(c.x - wx, c.y - 20 - wy) < 60);
  if (clam) diver.target = { x: clam.x, y: clam.y - 30 };
  else diver.target = { x: wx, y: Math.max(wy, WL + 14) };
});

// ---------- player update -------------------------------------------------
function updateDiver(dt) {
  let ix = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
  let iy = (held('down') ? 1 : 0) - (held('up') ? 1 : 0);
  if (diver.target) {
    const dx = diver.target.x - diver.x, dy = diver.target.y - diver.y, d = Math.hypot(dx, dy);
    if (d < 18 || diver.stuck > 0.6) { diver.target = null; diver.stuck = 0; }
    else { ix = dx / d; iy = dy / d; }
  }
  const l = Math.hypot(ix, iy);
  if (l > 1) { ix /= l; iy /= l; }
  diver.vx += ix * 800 * dt; diver.vy += iy * 800 * dt;
  const drag = Math.exp(-2.6 * dt);
  diver.vx *= drag; diver.vy *= drag;
  diver.vy += 10 * dt;                             // a little negative buoyancy
  // move one axis at a time so walls and floors stop the diver cleanly
  const nx = diver.x + diver.vx * dt;
  if (hits(nx, diver.y, HW, HH)) { diver.vx = 0; if (diver.target) diver.stuck = (diver.stuck || 0) + dt; } else diver.x = nx;
  let ny = Math.max(diver.y + diver.vy * dt, WL + 10);
  if (hits(diver.x, ny, HW, HH)) { diver.vy = 0; if (diver.target) diver.stuck = (diver.stuck || 0) + dt; } else diver.y = ny;
  if (diver.y <= WL + 10) diver.vy = Math.max(diver.vy, 0);
  if (Math.abs(diver.vx) > 20) diver.face = Math.sign(diver.vx);

  // air: only the attic has any
  const depth = Math.max(0, diver.y - WL) / UNITS_PER_M;
  if (diver.y < WL + 26) {
    if (game.o2 < 99) toast('Breathing', 0.6);
    game.o2 = Math.min(100, game.o2 + 30 * dt);
  } else {
    game.o2 -= (1.1 + depth * 0.05) * dt;
    game.breathTimer -= dt;
    if (game.breathTimer <= 0) {
      game.breathTimer = rr(3, 4.2);
      for (let i = 0; i < 5; i++) spawnBubble(diver.x + diver.face * 34 + rr(-4, 4), diver.y - 12 - i * 8);
    }
  }
  if (game.o2 <= 0) { game.o2 = 0; endGame(false); }
}

function updateInteractions(dt) {
  game.stingCooldown -= dt;
  for (const j of jellies) {
    if (Math.hypot(j.x - diver.x, j.y + 18 * j.s - diver.y) < 30 * j.s + 22 && game.stingCooldown <= 0) {
      game.stingCooldown = 1.5;
      game.o2 = Math.max(0, game.o2 - 12);
      const dx = diver.x - j.x, dy = diver.y - j.y, d = Math.hypot(dx, dy) || 1;
      diver.vx += dx / d * 240; diver.vy += dy / d * 240;
      diver.target = null;
      ui.flash.classList.add('on');
      requestAnimationFrame(() => requestAnimationFrame(() => ui.flash.classList.remove('on')));
      toast('Stung! −12% air');
    }
  }
  let nearest = null, nd = Infinity;
  for (const c of clams) {
    if (c.taken) continue;
    const d = Math.hypot(c.x - diver.x, c.y - 20 - diver.y);
    if (d < 58) {
      c.taken = true;
      game.score++;
      game.o2 = Math.min(100, game.o2 + 10);
      for (let i = 0; i < 8; i++) spawnBubble(c.x + rr(-12, 12), c.y - 16 - i * 5, rr(2, 4));
      toast(game.score === clams.length ? 'Last pearl!' : `Pearl ${game.score} of ${clams.length} · +10% air`);
      if (game.score === clams.length) setTimeout(() => endGame(true), 900);
    } else if (d < nd) { nd = d; nearest = c; }
  }
  if (nearest) {
    const ang = Math.atan2(nearest.x - diver.x, -(nearest.y - 20 - diver.y)) * 180 / Math.PI;
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
  hudTimer = 0.15;
  const depth = Math.max(0, (diver.y - WL) / UNITS_PER_M);
  ui.depth.innerHTML = `${Math.round(depth)}<small>m</small>`;
  ui.pearls.textContent = String(game.score);
  ui.pearlsOf.textContent = `of ${clams.length}`;
  ui.o2Fill.style.transform = `scaleX(${(game.o2 / 100).toFixed(3)})`;
  ui.o2Val.textContent = `${Math.ceil(game.o2)}%`;
  ui.o2.classList.toggle('low', game.o2 < 25);
  ui.focusHint.hidden = document.hasFocus();
}

// =====================================================================
// Drawing: flat fills, thin ink lines, everything straight on
// =====================================================================
function ink(w = 1.5) { ctx.strokeStyle = PAL.ink; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
function box(x, y, w, h, fill, lw = 1.5) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); ink(lw); ctx.strokeRect(x, y, w, h); }
function circle(x, y, r, fill, stroke = true) { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); if (stroke) { ink(); ctx.stroke(); } }

function drawSplat(x, y, r, color, rot) {
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
function drawWallpaper(r) {
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
  else if (r.pattern === 'dado') { ctx.fillRect(r.x0, r.y1 - 36, w, 36); }
}
function drawChair(x, y, face, color = PAL.brown) {
  // a folding chair in profile
  ctx.save(); ctx.translate(x, y); ctx.scale(face, 1);
  ink(3.2); ctx.strokeStyle = color;
  ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(12, -42); ctx.moveTo(14, 0); ctx.lineTo(-10, -42); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-18, -42); ctx.lineTo(16, -42); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-16, -42); ctx.lineTo(-20, -86); ctx.stroke();
  ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-19, -78); ctx.lineTo(-4, -78); ctx.moveTo(-18, -66); ctx.lineTo(-4, -66); ctx.stroke();
  ctx.restore();
}
function drawThing(t, st) {
  const { x, y } = t;
  switch (t.type) {
    case 'chair': drawChair(x, y, t.face); break;
    case 'suitcases':
      box(x - 40, y - 36, 80, 36, PAL.brown); box(x - 34, y - 64, 68, 28, PAL.red); box(x - 26, y - 86, 52, 22, PAL.greyLight);
      ink(); for (const [yy, ww] of [[-36, 16], [-64, 14], [-86, 12]]) { ctx.strokeRect(x - ww / 2, y + yy - 6, ww, 6); }
      break;
    case 'roundWindow':
      circle(x, y, 44, PAL.sky); ink(2); ctx.beginPath(); ctx.moveTo(x - 44, y); ctx.lineTo(x + 44, y); ctx.moveTo(x, y - 44); ctx.lineTo(x, y + 44); ctx.stroke();
      ctx.lineWidth = 6; ctx.strokeStyle = PAL.trim; ctx.beginPath(); ctx.arc(x, y, 47, 0, 7); ctx.stroke();
      break;
    case 'window': {
      box(x - 40, y - 50, 80, 100, PAL.sky, 2);
      ctx.fillStyle = PAL.white; ctx.fillRect(x - 36, y - 46, 72, 92);
      ctx.fillStyle = PAL.sky; for (const [cx, cy] of [[-34, -44], [2, -44], [-34, 2], [2, 2]]) ctx.fillRect(x + cx, y + cy, 32, 42);
      ctx.fillStyle = PAL.trim; ctx.fillRect(x - 48, y + 50, 96, 8);
      break;
    }
    case 'painting':
      box(x - 70, y - 44, 140, 88, PAL.paper, 2);
      ctx.fillStyle = PAL.mint; ctx.fillRect(x - 64, y + 10, 128, 28);
      box(x - 20, y - 14, 40, 26, PAL.red, 1.2); ctx.fillStyle = PAL.brown; ctx.beginPath(); ctx.moveTo(x - 26, y - 14); ctx.lineTo(x, y - 32); ctx.lineTo(x + 26, y - 14); ctx.fill();
      break;
    case 'picture':
      box(x - 46, y - 34, 92, 68, PAL.paper, 2);
      box(x - 30, y - 6, 26, 26, PAL.red, 1.2); circle(x + 18, y - 8, 12, PAL.blue, false); ctx.fillStyle = PAL.green; ctx.fillRect(x - 2, y + 6, 22, 14);
      break;
    case 'sofa':
      ctx.fillStyle = PAL.blue;
      ctx.beginPath(); ctx.roundRect(x - 110, y - 80, 220, 50, 10); ctx.fill();
      ctx.fillRect(x - 118, y - 40, 236, 30);
      ctx.beginPath(); ctx.roundRect(x - 126, y - 62, 22, 52, 8); ctx.roundRect(x + 104, y - 62, 22, 52, 8); ctx.fill();
      ctx.fillStyle = PAL.brown; ctx.fillRect(x - 108, y - 10, 8, 10); ctx.fillRect(x + 100, y - 10, 8, 10);
      ink(1.2); ctx.beginPath(); ctx.moveTo(x, y - 76); ctx.lineTo(x, y - 12); ctx.stroke();
      break;
    case 'lamp':
      ctx.fillStyle = PAL.ink; ctx.fillRect(x - 1.5, y - 150, 3, 150); ctx.fillRect(x - 16, y - 4, 32, 4);
      ctx.fillStyle = PAL.yellow; ctx.beginPath(); ctx.moveTo(x - 16, y - 150); ctx.lineTo(x + 16, y - 150); ctx.lineTo(x + 26, y - 186); ctx.lineTo(x - 26, y - 186); ctx.closePath(); ctx.fill(); ink(1.2); ctx.stroke();
      break;
    case 'sideTable':
      ctx.fillStyle = PAL.wood; ctx.fillRect(x - 30, y - 60, 60, 8); ctx.fillRect(x - 26, y - 52, 5, 52); ctx.fillRect(x + 21, y - 52, 5, 52); break;
    case 'clock':
      box(x - 26, y - 200, 52, 200, PAL.wood); circle(x, y - 166, 18, PAL.paper);
      ink(1.5); ctx.beginPath(); ctx.moveTo(x, y - 166); ctx.lineTo(x, y - 178); ctx.moveTo(x, y - 166); ctx.lineTo(x + 9, y - 162); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - 140); ctx.lineTo(x + ((Math.floor(st * 2) % 2) ? 8 : -8), y - 70); ctx.stroke();
      circle(x + ((Math.floor(st * 2) % 2) ? 8 : -8), y - 66, 7, PAL.yellow);
      break;
    case 'plant':
      box(x - 18, y - 36, 36, 36, PAL.red); ctx.fillStyle = TEX.plant; ctx.beginPath(); ctx.ellipse(x, y - 80, 30, 46, 0, 0, 7); ctx.fill();
      break;
    case 'table':
      ctx.fillStyle = PAL.wood; ctx.fillRect(x - 90, y - 64, 180, 8); ctx.fillRect(x - 84, y - 56, 6, 56); ctx.fillRect(x + 78, y - 56, 6, 56);
      ctx.fillStyle = PAL.red; ctx.fillRect(x - 70, y - 72, 22, 8);
      break;
    case 'fridge':
      ctx.fillStyle = PAL.white; ctx.beginPath(); ctx.roundRect(x - 38, y - 166, 76, 166, 8); ctx.fill(); ink(1.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 38, y - 110); ctx.lineTo(x + 38, y - 110); ctx.stroke();
      ctx.fillStyle = PAL.ink; ctx.fillRect(x + 24, y - 150, 4, 26); ctx.fillRect(x + 24, y - 96, 4, 34);
      break;
    case 'stove':
      box(x - 40, y - 80, 80, 80, PAL.greyLight); box(x - 28, y - 60, 56, 40, PAL.ink);
      for (const dx of [-18, 18]) { ctx.fillStyle = PAL.ink; ctx.fillRect(x + dx - 12, y - 84, 24, 4); }
      break;
    case 'counter':
      ctx.fillStyle = PAL.mint; ctx.fillRect(t.x0, y - 76, t.x1 - t.x0, 76); ctx.fillStyle = PAL.paper; ctx.fillRect(t.x0 - 6, y - 82, t.x1 - t.x0 + 12, 8);
      ink(1.2); for (let xx = t.x0; xx < t.x1; xx += 55) ctx.strokeRect(xx + 4, y - 68, 47, 60);
      break;
    case 'shelf':
      ctx.fillStyle = PAL.wood; ctx.fillRect(t.x0, y, t.x1 - t.x0, 6);
      for (let xx = t.x0 + 16, k = 0; xx < t.x1 - 10; xx += 30, k++) { ctx.fillStyle = [PAL.paper, PAL.blue, PAL.red][k % 3]; ctx.beginPath(); ctx.arc(xx, y - 12, 12, Math.PI, 0); ctx.fill(); ctx.fillRect(xx - 12, y - 12, 24, 12); }
      break;
    case 'hatchLadder':
      ink(2.2); ctx.strokeStyle = PAL.brown;
      ctx.beginPath(); ctx.moveTo(x - 18, t.y0); ctx.lineTo(x - 18, t.y1); ctx.moveTo(x + 18, t.y0); ctx.lineTo(x + 18, t.y1); ctx.stroke();
      for (let yy = t.y0 + 22; yy < t.y1; yy += 26) { ctx.beginPath(); ctx.moveTo(x - 18, yy); ctx.lineTo(x + 18, yy); ctx.stroke(); }
      break;
    case 'tub':
      ctx.fillStyle = PAL.white; ctx.beginPath(); ctx.moveTo(x - 100, y - 70); ctx.lineTo(x + 100, y - 70); ctx.lineTo(x + 90, y - 22); ctx.quadraticCurveTo(x, y - 8, x - 90, y - 22); ctx.closePath(); ctx.fill(); ink(1.6); ctx.stroke();
      ctx.fillStyle = PAL.ink; for (const dx of [-76, 76]) ctx.fillRect(x + dx - 4, y - 18, 8, 18);
      ctx.fillStyle = PAL.greyLight; ctx.fillRect(x - 108, y - 110, 6, 40); ctx.fillRect(x - 108, y - 110, 24, 6);
      break;
    case 'mirror': box(x - 34, y - 46, 68, 92, '#d8e8f0', 2); ctx.fillStyle = PAL.white; ctx.fillRect(x - 20, y - 36, 6, 50); break;
    case 'sink':
      ctx.fillStyle = PAL.white; ctx.beginPath(); ctx.moveTo(x - 36, y - 80); ctx.lineTo(x + 36, y - 80); ctx.lineTo(x + 28, y - 60); ctx.lineTo(x - 28, y - 60); ctx.closePath(); ctx.fill(); ink(1.5); ctx.stroke();
      ctx.fillStyle = PAL.greyLight; ctx.fillRect(x - 8, y - 60, 16, 60); ink(1.2); ctx.strokeRect(x - 8, y - 60, 16, 60);
      break;
    case 'easel':
      ink(3); ctx.strokeStyle = PAL.wood;
      ctx.beginPath(); ctx.moveTo(x - 50, y); ctx.lineTo(x, y - 190); ctx.lineTo(x + 50, y); ctx.moveTo(x, y - 190); ctx.lineTo(x + 6, y); ctx.stroke();
      box(x - 60, y - 170, 120, 90, PAL.ink, 1);
      ctx.strokeStyle = PAL.paper; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - 40, y - 150); ctx.lineTo(x - 30, y - 158); ctx.lineTo(x - 30, y - 128); ctx.moveTo(x - 10, y - 156); ctx.lineTo(x + 6, y - 156); ctx.lineTo(x - 6, y - 130); ctx.stroke();
      break;
    case 'desk':
      ctx.fillStyle = PAL.paper; ctx.fillRect(x - 46, y - 58, 92, 6); ink(1.4); ctx.strokeRect(x - 46, y - 58, 92, 6);
      ctx.fillStyle = PAL.ink; ctx.fillRect(x - 42, y - 52, 3, 52); ctx.fillRect(x + 39, y - 52, 3, 52);
      ctx.fillStyle = PAL.red; ctx.fillRect(x + 14, y - 64, 20, 6);
      drawChair(x + 60, y, -1, PAL.ink);
      break;
    case 'wardrobe':
      box(x - 42, y - 190, 84, 190, PAL.mint, 1.6); ink(1.4); ctx.beginPath(); ctx.moveTo(x, y - 190); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = PAL.ink; ctx.fillRect(x - 8, y - 104, 3, 14); ctx.fillRect(x + 5, y - 104, 3, 14);
      break;
    case 'pendant':
      ink(1.2); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 60); ctx.stroke();
      ctx.fillStyle = PAL.paper; ctx.beginPath(); ctx.arc(x, y + 76, 16, Math.PI, 0); ctx.closePath(); ctx.fill(); ink(1.4); ctx.stroke();
      break;
    case 'bed':
      ctx.fillStyle = PAL.wood; ctx.fillRect(x - 120, y - 100, 10, 100); ctx.fillRect(x + 110, y - 70, 10, 70);
      ctx.fillStyle = PAL.paper; ctx.fillRect(x - 110, y - 58, 220, 28);
      ctx.fillStyle = PAL.red; ctx.fillRect(x - 40, y - 64, 150, 34);
      ctx.fillStyle = PAL.white; ctx.beginPath(); ctx.roundRect(x - 106, y - 72, 54, 16, 7); ctx.fill(); ink(1.2); ctx.stroke();
      ctx.fillStyle = PAL.wood; ctx.fillRect(x - 110, y - 30, 220, 10);
      break;
    case 'nightstand': box(x - 26, y - 50, 52, 50, PAL.wood, 1.2); ctx.fillStyle = PAL.ink; ctx.fillRect(x - 5, y - 30, 10, 3); break;
    case 'boiler': {
      ctx.fillStyle = PAL.greyLight; ctx.beginPath(); ctx.roundRect(x - 56, y - 180, 112, 180, [40, 40, 0, 0]); ctx.fill(); ink(1.6); ctx.stroke();
      box(x - 22, y - 80, 44, 36, PAL.ink, 1.2);
      const alt = Math.floor(st * 3) % 2;
      ctx.fillStyle = PAL.red; ctx.beginPath(); ctx.moveTo(x - 20, y - 46);
      for (let k = 0; k <= 5; k++) ctx.lineTo(x - 20 + k * 8, y - 46 - (k % 2 === alt ? 26 : 12));
      ctx.lineTo(x + 20, y - 46); ctx.closePath(); ctx.fill();
      ctx.fillStyle = PAL.ink; ctx.fillRect(x - 4, y - 260, 8, 80);
      break;
    }
    case 'boxes':
      box(x - 60, y - 56, 70, 56, PAL.wood, 1.3); box(x + 10, y - 50, 56, 50, PAL.wood, 1.3); box(x - 34, y - 104, 70, 48, PAL.wood, 1.3);
      ink(1); for (const [bx, by, bw] of [[-60, -56, 70], [10, -50, 56], [-34, -104, 70]]) { ctx.beginPath(); ctx.moveTo(x + bx + bw / 2, y + by); ctx.lineTo(x + bx + bw / 2, y + by + 14); ctx.stroke(); }
      break;
    case 'washer':
      box(x - 42, y - 96, 84, 96, PAL.white, 1.6); circle(x, y - 44, 26, PAL.blue); circle(x, y - 44, 16, '#d8e8f0');
      ctx.fillStyle = PAL.ink; ctx.fillRect(x - 32, y - 88, 18, 6);
      break;
    case 'jars':
      ctx.fillStyle = PAL.wood; ctx.fillRect(t.x0, y, t.x1 - t.x0, 6);
      for (let xx = t.x0 + 20, k = 0; xx < t.x1 - 10; xx += 36, k++) { box(xx - 11, y - 34, 22, 34, [PAL.yellow, PAL.red, PAL.mint][k % 3], 1.1); ctx.fillStyle = PAL.ink; ctx.fillRect(xx - 11, y - 40, 22, 6); }
      break;
    case 'redDoor':
      box(x - 42, y - 170, 84, 170, PAL.red, 1.8); box(x - 30, y - 150, 26, 60, PAL.red, 1.2); box(x + 4, y - 150, 26, 60, PAL.red, 1.2);
      circle(x + 26, y - 80, 4, PAL.yellow, false);
      ctx.fillStyle = PAL.yellow; ctx.fillRect(x - 50, y - 4, 100, 4);
      break;
  }
}
function drawClam(c, frame) {
  const { x, y } = c;
  ink(1.4);
  ctx.fillStyle = PAL.paper;
  if (c.taken) {
    ctx.beginPath(); ctx.arc(x, y, 18, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    for (const a of [0.25, 0.5, 0.75]) { const t = Math.PI + a * Math.PI; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(t) * 18, y + Math.sin(t) * 18); ctx.stroke(); }
    return;
  }
  ctx.beginPath(); ctx.moveTo(x - 19, y - 6); ctx.lineTo(x + 19, y - 6); ctx.lineTo(x + 14, y); ctx.lineTo(x - 14, y); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y - 19, 19, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  for (const a of [0.25, 0.5, 0.75]) { const t = Math.PI + a * Math.PI; ctx.beginPath(); ctx.moveTo(x, y - 19); ctx.lineTo(x + Math.cos(t) * 19, y - 19 + Math.sin(t) * 19); ctx.stroke(); }
  circle(x, y - 12, 5.5, PAL.white);
  drawSplat(x, y - 56, 12, c.color, (frame % 8) * (Math.PI / 16) + c.phase);
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
  const r = 20 * j.s;
  ink(1.3);
  for (let k = -2; k <= 2; k++) {
    const len = (k % 2 ? 32 : 44) * j.s;
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
  for (const [oy, swing] of [[-3, 0.1 + k * 0.15], [4, -0.06 - k * 0.15]]) {
    ctx.save(); ctx.translate(-22, oy); ctx.rotate(swing);
    ctx.fillStyle = PAL.ink; ctx.fillRect(-28, -3.5, 30, 7);
    ctx.beginPath(); ctx.moveTo(-26, -3); ctx.lineTo(-46, -10); ctx.lineTo(-44, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = PAL.greyLight; ctx.fillRect(-22, -19, 34, 9); ink(1.1); ctx.strokeRect(-22, -19, 34, 9);
  ctx.fillStyle = PAL.red; ctx.beginPath(); ctx.roundRect(-25, -10, 48, 19, 9); ctx.fill();
  ctx.fillStyle = PAL.ink; ctx.fillRect(-5, -10, 3, 19);
  ctx.save(); ctx.translate(13, 3); ctx.rotate(0.3 - k * 0.1); ctx.fillStyle = PAL.red; ctx.fillRect(0, -3, 19, 6);
  ctx.fillStyle = PAL.cream; ctx.beginPath(); ctx.arc(21, 0, 4, 0, 7); ctx.fill(); ctx.restore();
  ctx.fillStyle = PAL.cream; ctx.beginPath(); ctx.arc(30, -5, 9.5, 0, 7); ctx.fill();
  ctx.fillStyle = PAL.ink; ctx.beginPath(); ctx.arc(28.5, -7, 10, Math.PI * 0.9, Math.PI * 1.95); ctx.closePath(); ctx.fill();
  ctx.fillStyle = PAL.blue; ctx.fillRect(32, -10, 9, 7); ink(1.1); ctx.strokeRect(32, -10, 9, 7);
  ctx.restore();
}

// the outside: sky, stippled clouds, a plane, a telephone pole, the lawn and a picket gate
const clouds = [{ x: 420, y: 150 }, { x: 1700, y: 110 }, { x: 2350, y: 220 }].map((c) => ({ ...c, parts: Array.from({ length: 5 }, (_, k) => ({ dx: k * 32 - 64 + rr(-6, 6), dy: rr(-8, 8), rx: rr(36, 56), ry: rr(12, 18) })) }));
function drawOutside(t) {
  ctx.fillStyle = PAL.sky; ctx.fillRect(0, 0, W, GROUND);
  ctx.fillStyle = TEX.cloud;
  for (const c of clouds) { ctx.beginPath(); for (const p of c.parts) { ctx.moveTo(c.x + p.dx + p.rx, c.y + p.dy); ctx.ellipse(c.x + p.dx, c.y + p.dy, p.rx, p.ry, 0, 0, 7); } ctx.fill(); }
  const px = ((t * 18) % (W + 300)) - 150;
  ctx.fillStyle = PAL.ink;
  ctx.beginPath(); ctx.ellipse(px, 70, 24, 3.5, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(px - 3, 70); ctx.lineTo(px - 13, 59); ctx.lineTo(px - 7, 59); ctx.lineTo(px + 6, 70); ctx.fill();
  // telephone pole
  ctx.fillStyle = PAL.brown; ctx.fillRect(96, 180, 12, GROUND - 180); ctx.fillRect(66, 204, 72, 6);
  ctx.fillStyle = PAL.ink; for (let y = 320; y < GROUND - 60; y += 70) { ctx.fillRect(84, y, 12, 3); ctx.fillRect(108, y + 35, 12, 3); }
  // lawn and picket gate
  ctx.fillStyle = TEX.lawn; ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.fillStyle = PAL.white;
  for (let k = 0; k < 6; k++) { const x = 2440 + k * 22; ctx.beginPath(); ctx.moveTo(x, GROUND); ctx.lineTo(x, GROUND - 70); ctx.lineTo(x + 7, GROUND - 80); ctx.lineTo(x + 14, GROUND - 70); ctx.lineTo(x + 14, GROUND); ctx.fill(); }
  ctx.fillRect(2436, GROUND - 56, 136, 7); ctx.fillRect(2436, GROUND - 26, 136, 7);
}
function drawShell(st) {
  // roof, chimney with flames, attic gable
  ctx.fillStyle = PAL.roof;
  ctx.beginPath(); ctx.moveTo(150, 410); ctx.lineTo(1300, 90); ctx.lineTo(2450, 410); ctx.closePath(); ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = PAL.roofLine;
  for (let y = 110; y < 410; y += 22) ctx.fillRect(0, y, W, 2);
  ctx.restore();
  ctx.fillStyle = PAL.trim; ctx.beginPath(); ctx.moveTo(150, 410); ctx.lineTo(1300, 90); ctx.lineTo(2450, 410); ctx.lineTo(2450, 400); ctx.lineTo(1300, 78); ctx.lineTo(150, 400); ctx.closePath(); ctx.fill();
  ctx.fillStyle = PAL.red; ctx.fillRect(1760, 150, 90, 120);
  ink(1); for (let y = 170; y < 270; y += 18) { ctx.beginPath(); ctx.moveTo(1760, y); ctx.lineTo(1850, y); ctx.stroke(); }
  const alt = Math.floor(st * 3) % 2;
  ctx.fillStyle = PAL.red; ctx.beginPath(); ctx.moveTo(1760, 150);
  for (let k = 0; k <= 8; k++) ctx.lineTo(1760 + k * 11.25, 150 - (k % 2 === alt ? 34 : 12));
  ctx.lineTo(1850, 150); ctx.closePath(); ctx.fill();
  // outer walls with siding, slabs, interior walls
  for (const x of [200, 2376]) {
    ctx.fillStyle = PAL.siding; ctx.fillRect(x, 400, 24, 1300);
    ctx.fillStyle = PAL.sidingLine; for (let y = 412; y < 1700; y += 12) ctx.fillRect(x, y, 24, 1.5);
  }
  ctx.fillStyle = PAL.siding;
  for (const s of SLABS) { ctx.fillRect(224, s.y, s.hatch[0] - 224, 24); ctx.fillRect(s.hatch[1], s.y, 2376 - s.hatch[1], 24); }
  for (const w of WALLS) ctx.fillRect(w.x, w.y0, 18, w.y1 - w.y0 - DOOR_H);
  ctx.fillStyle = PAL.trim;
  for (const s of SLABS) { ctx.fillRect(224, s.y + 24, s.hatch[0] - 224, 4); ctx.fillRect(s.hatch[1], s.y + 24, 2376 - s.hatch[1], 4); }
  for (const w of WALLS) ctx.fillRect(w.x - 4, w.y1 - DOOR_H, 26, 6);   // door lintels
  ctx.fillStyle = '#c9c1ab'; ctx.fillRect(200, 1672, 2200, 28);            // foundation
  ink(1.5);
  ctx.strokeRect(200, 400, 2200, 1300);
}

function render(t, frame, st) {
  const dpr = view.dpr, sc = view.scale;
  ctx.setTransform(dpr * sc, 0, 0, dpr * sc, -view.x * dpr * sc, -view.y * dpr * sc);
  drawOutside(t);
  for (const r of ROOMS) drawWallpaper(r);
  for (const s of splats) drawSplat(s.x, s.y, s.r, s.color, s.rot);
  for (const th of things) drawThing(th, st);
  for (const c of clams) drawClam(c, frame);
  // the flood: one even tint over every room below the water line
  ctx.fillStyle = WATER_TINT;
  for (const r of ROOMS) { const top = Math.max(r.y0, WL); if (top < r.y1) ctx.fillRect(r.x0, top, r.x1 - r.x0, r.y1 - top); }
  for (const s of SLABS) ctx.fillRect(s.hatch[0], s.y, s.hatch[1] - s.hatch[0], 24);
  for (const w of WALLS) ctx.fillRect(w.x, w.y1 - DOOR_H, 18, DOOR_H);
  ink(1.4); ctx.beginPath(); ctx.moveTo(224, WL); ctx.lineTo(2376, WL); ctx.stroke();
  ctx.fillStyle = PAL.ink;
  for (let x = 250; x < 2360; x += 36) { ctx.beginPath(); ctx.moveTo(x - 4, WL + 6); ctx.lineTo(x, WL + 11); ctx.lineTo(x + 4, WL + 6); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.2; ctx.stroke(); }
  drawShell(st);
  for (const j of jellies) drawJelly(j);
  const flick = frame % 2 ? 2 : -2;
  for (const s of schools) for (const m of s.members) drawFish(m.x, m.y, s.kind, s.dir, flick);
  if (game.state === 'play') drawDiver(frame, Math.hypot(diver.vx, diver.vy) > 40);
  ink(1); ctx.fillStyle = PAL.white;
  for (const b of bubbles) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); ctx.stroke(); }
  if (diver.target && game.state === 'play') {
    ink(1.4);
    const { x, y } = diver.target;
    ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6); ctx.stroke();
  }
  // pencil grain, fixed to the screen like the page itself
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
  const cx = clamp(tx - view.w / 2, Math.min(0, W - view.w), Math.max(0, W - view.w));
  const cy = clamp(ty - view.h * 0.45, 0, Math.max(0, H - view.h));
  const k = Math.min(1, dt * 3);
  view.x = lerp(view.x, cx, k);
  view.y = lerp(view.y, cy, k);
}

// ---------- main loop ---------------------------------------------------------
let last = performance.now(), t = 0, menuT = 0;
resetGame();
view.x = clamp(diver.x - view.w / 2, 0, Math.max(0, W - view.w));
view.y = clamp(diver.y - view.h * 0.45, 0, Math.max(0, H - view.h));
const MENU_PATH = [[900, 420], [1500, 900], [700, 1200], [1500, 1500], [1300, 600]];

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
    // wander slowly from room to room behind the menu
    menuT += dt * 0.04;
    const i = Math.floor(menuT) % MENU_PATH.length, f = menuT % 1, a = MENU_PATH[i], b = MENU_PATH[(i + 1) % MENU_PATH.length];
    const e = f * f * (3 - 2 * f);
    updateCamera(dt, lerp(a[0], b[0], e), lerp(a[1], b[1], e));
  }
  updateFish(dt, game.state === 'play' ? diver : { x: -9999, y: -9999 });
  for (const j of jellies) { j.x = j.hx; j.y = j.hy + (frame % 4 < 2 ? -5 : 5); }
  updateBubbles(dt);
  render(t, frame, st);
  requestAnimationFrame(frameLoop);
}
requestAnimationFrame(frameLoop);

// exposed for tinkering from the console
window.deepHouse = { diver, game, clams, jellies, schools };
