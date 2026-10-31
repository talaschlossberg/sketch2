// Little World — a tiny paper-collage world with two places:
// a field under the sky (outside) and a red room (inside).
// Everything is drawn on one canvas in a fixed 1920x1080 "stage".

const W = 1920, H = 1080, HORIZON = 742;
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const hint = document.getElementById('hint');

let dpr = 1, scale = 1, ox = 0, oy = 0;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = innerWidth * dpr;
  cv.height = innerHeight * dpr;
  scale = Math.min(innerWidth / W, innerHeight / H);
  ox = (innerWidth - W * scale) / 2;
  oy = (innerHeight - H * scale) / 2;
}
addEventListener('resize', resize);
resize();

// ---------- little helpers ----------
function seeded(s) { return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function canvas(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  return c;
}
const spring = (o, key, target, k, damp, dt) => {
  const v = key + 'V';
  o[v] = (o[v] || 0) + (target - o[key]) * k * dt;
  o[v] *= Math.pow(damp, dt * 60);
  o[key] += o[v] * dt;
};

// Paper with flecks, used as a pattern fill so shapes look cut from paper.
function paper(base, flecks = 2500, size = 256, seed = 7) {
  const r = seeded(seed);
  return ctx.createPattern(canvas(size, size, g => {
    g.fillStyle = base; g.fillRect(0, 0, size, size);
    for (let i = 0; i < flecks; i++) {
      g.globalAlpha = r() * 0.18;
      g.fillStyle = r() < 0.5 ? '#fff' : '#000';
      const s = 1 + r() * 2;
      g.fillRect(r() * size, r() * size, s, s);
    }
  }), 'repeat');
}

// Film grain laid over everything.
const grain = canvas(240, 240, (g, w, h) => {
  const img = g.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
});
const grainPattern = ctx.createPattern(grain, 'repeat');

// ---------- sound (a soft plink per touch) ----------
let audio = null;
function note(freq, dur = 0.7, vol = 0.12, type = 'sine') {
  if (!audio) return;
  const t = audio.currentTime;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination);
  o.start(t); o.stop(t + dur);
}

// ---------- shared sky ----------
const CW = 3840;
const clouds = canvas(CW, 760, g => {
  const r = seeded(42);
  const blob = (x, y, rad, a) => {
    for (const dx of [-CW, 0, CW]) {
      const gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, rad);
      gr.addColorStop(0, `rgba(255,255,255,${a})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(x + dx - rad, y - rad, rad * 2, rad * 2);
    }
  };
  for (let c = 0; c < 16; c++) {
    const cx = r() * CW, cy = 140 + r() * 460;
    const sx = 180 + r() * 380, sy = 40 + r() * 90;
    const n = 20 + r() * 30;
    for (let i = 0; i < n; i++) {
      blob(cx + (r() - 0.5) * sx * 2, cy + (r() - 0.5) * sy * 2, 40 + r() * 90, 0.18 + r() * 0.25);
    }
  }
});
function drawSky(x, y, w, h, t, zoom = 1, cx = x, cy = y, gy = y, gh = h) {
  const gr = ctx.createLinearGradient(0, gy, 0, gy + gh);
  gr.addColorStop(0, '#6c9de0');
  gr.addColorStop(1, '#c6d8ee');
  ctx.fillStyle = gr;
  ctx.fillRect(x, y, w, h);
  const off = (t * 14) % CW;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.translate(cx, cy); ctx.scale(zoom, zoom);
  ctx.drawImage(clouds, -off, 0);
  ctx.drawImage(clouds, CW - off, 0);
  if (w > CW * zoom) ctx.drawImage(clouds, -CW - off, 0);
  ctx.restore();
}

// =====================================================================
// OUTSIDE
// =====================================================================
const grass = canvas(W, H - HORIZON + 400, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#36a072'); gr.addColorStop(0.5, '#2e9165'); gr.addColorStop(1, '#2a8a5d');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const r = seeded(3);
  for (let i = 0; i < 3500; i++) {
    const y = r() * h, len = 20 + r() * 140 * (0.4 + y / h);
    g.globalAlpha = 0.05 + r() * 0.07;
    g.fillStyle = r() < 0.5 ? '#0f5a3a' : '#7fd0a0';
    g.fillRect(r() * w, y, len, 1 + r() * 3 * (y / h));
  }
  g.globalAlpha = 1;
});

const water = canvas(300, 200, (g, w, h) => {
  g.fillStyle = '#2f60c6'; g.fillRect(0, 0, w, h);
  const r = seeded(9);
  for (let i = 0; i < 260; i++) {
    g.globalAlpha = 0.1 + r() * 0.15;
    g.fillStyle = r() < 0.6 ? '#5f8ae0' : '#1d43a0';
    g.fillRect(r() * w, r() * h, 10 + r() * 40, 1 + r() * 2);
  }
});
const waterPattern = ctx.createPattern(water, 'repeat');

const ballImg = canvas(240, 240, g => {
  const c = 120, R = 118;
  g.save();
  g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.clip();
  const gr = g.createRadialGradient(165, 85, 10, 120, 120, R);
  gr.addColorStop(0, '#ffe54d'); gr.addColorStop(0.45, '#ffb425'); gr.addColorStop(1, '#f0661d');
  g.fillStyle = gr; g.fillRect(0, 0, 240, 240);
  // dimples
  g.fillStyle = 'rgba(160,60,0,.18)';
  for (let y = 0; y < 240; y += 9) for (let x = (y / 9) % 2 ? 4 : 0; x < 240; x += 9) {
    g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill();
  }
  const hl = g.createRadialGradient(170, 90, 0, 170, 90, 45);
  hl.addColorStop(0, 'rgba(255,255,255,.75)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hl; g.fillRect(0, 0, 240, 240);
  g.restore();
});

const yellowPaper = paper('#e6c335', 1800, 256, 11);
const redPaper = paper('#c23a35', 1800, 256, 12);
const doorPaper = paper('#eeeee2', 1200, 256, 13);

const triangle = {
  x: 460, y: 190, rot: 0, target: 0, bob: 0,
  pts: [[0, -132], [-188, 68], [188, 68]],
  hit(px, py) {
    const [a, b, c] = this.pts.map(([x, y]) => [x, y]);
    const [lx, ly] = local(this, px, py);
    const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
    const P = [lx, ly], d1 = s(P, a, b), d2 = s(P, b, c), d3 = s(P, c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  },
  tap() { this.target += Math.PI * 2 / 3; note(784, 0.9); },
  draw(t) {
    ctx.save();
    ctx.translate(this.x, this.y + Math.sin(t * 0.9) * 7);
    ctx.rotate(this.rot);
    ctx.beginPath();
    this.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.fillStyle = yellowPaper; ctx.fill();
    ctx.restore();
  },
};

const card = {
  x: 1523, y: 752, rot: 0.34, target: 0.34, w: 212, h: 245,
  hit(px, py) { const [lx, ly] = local(this, px, py); return Math.abs(lx) < this.w / 2 && Math.abs(ly) < this.h / 2; },
  tap() { this.target += Math.PI / 2; note(392, 0.8); },
  draw() {
    ctx.save();
    ctx.translate(this.x, this.y); ctx.rotate(this.rot);
    ctx.fillStyle = 'rgba(0,0,0,.08)';
    ctx.fillRect(-this.w / 2 + 6, -this.h / 2 + 8, this.w, this.h);
    ctx.fillStyle = redPaper;
    ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
    ctx.restore();
  },
};

function local(o, px, py) {
  const dx = px - o.x, dy = py - o.y, c = Math.cos(-o.rot), s = Math.sin(-o.rot);
  return [dx * c - dy * s, dx * s + dy * c];
}

const pond = { x: 960, y: 890, rx: 226, ry: 98, ripples: [] };
function pondPath(t) {
  ctx.beginPath();
  const n = 48, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.07 * Math.sin(3 * a + 1) + 0.05 * Math.sin(5 * a + 2) + 0.012 * Math.sin(a * 4 + t * 1.3);
    pts.push([pond.x + Math.cos(a) * pond.rx * k, pond.y + Math.sin(a) * pond.ry * k]);
  }
  for (let i = 0; i <= n; i++) {
    const p = pts[i % n], q = pts[(i + 1) % n];
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    i ? ctx.quadraticCurveTo(p[0], p[1], mx, my) : ctx.moveTo(mx, my);
  }
  ctx.closePath();
}

const ball = {
  x: 970, base: 757, h: 0, vh: 0, r: 92, squash: 0,
  hit(px, py) { return Math.hypot(px - this.x, py - (this.base + this.h)) < this.r; },
  tap() { if (this.h > -5) { this.vh = -1150; note(294, 0.6, 0.14, 'triangle'); } },
  update(dt) {
    if (this.h < 0 || this.vh < 0) {
      this.vh += 2600 * dt;
      this.h += this.vh * dt;
      if (this.h >= 0) {
        this.h = 0;
        if (this.vh > 250) {
          pond.ripples.push(0);
          note(147 + Math.random() * 30, 0.5, 0.12 * Math.min(1, this.vh / 1000));
          this.squash = Math.min(0.25, this.vh / 4000);
          this.vh = -this.vh * 0.42;
        } else this.vh = 0;
      }
    }
    this.squash *= Math.pow(0.85, dt * 60);
  },
  draw() {
    const y = this.base + this.h, s = this.squash, d = this.r * 2;
    ctx.drawImage(ballImg, this.x - this.r * (1 + s), y - this.r * (1 - s) + s * this.r, d * (1 + s), d * (1 - s));
  },
};

const door = {
  x: 332, y: 560, w: 168, h: 297, open: 0, target: 0, hover: false,
  hit(px, py) { return px > this.x && px < this.x + this.w && py > this.y && py < this.y + this.h; },
  tap() {
    this.target = 1;
    note(523, 0.8); setTimeout(() => note(659, 0.9), 140);
    setTimeout(() => go('in', this.x + this.w / 2, this.y + this.h / 2, '#c4513b'), 450);
  },
  draw() {
    const { x, y, w, h } = this;
    // the doorway shows the warm room behind
    const gr = ctx.createLinearGradient(x, y, x + w, y);
    gr.addColorStop(0, '#8e2f2a'); gr.addColorStop(1, '#c4513b');
    ctx.fillStyle = gr; ctx.fillRect(x, y, w, h);
    const ww = w * Math.cos(this.open * 1.35);
    ctx.save();
    ctx.translate(x, y); ctx.scale(Math.max(ww, 2) / w, 1);
    ctx.fillStyle = doorPaper; ctx.fillRect(0, 0, w, h);
    if (this.open > 0.01) { ctx.fillStyle = `rgba(0,0,0,${this.open * 0.3})`; ctx.fillRect(0, 0, w, h); }
    ctx.fillStyle = '#d9d8cc'; ctx.fillRect(w - 4, 0, 4, h);
    ctx.fillStyle = '#c9c8bb'; ctx.fillRect(49, 41, 62, 62);
    ctx.fillStyle = '#1d3a2e'; ctx.fillRect(56, 46, 50, 48);
    ctx.fillStyle = '#9d9c90'; ctx.fillRect(48, 101, 64, 3);
    ctx.fillStyle = '#d4161a';
    ctx.font = 'bold 44px Founders, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('IN', 80, 130);
    ctx.fillStyle = '#7d8187'; ctx.fillRect(142, 170, 26, 36);
    ctx.fillStyle = '#b8bcc0'; ctx.fillRect(138, 178, 14, 20);
    ctx.restore();
  },
};

const outside = {
  drag: [ball, card, triangle], // topmost first
  taps: [door],
  update(dt) {
    door.target = door.target === 1 ? 1 : (door.hover ? 0.12 : 0);
    spring(door, 'open', door.target, 120, 0.8, dt);
    spring(triangle, 'rot', triangle.target, 90, 0.86, dt);
    spring(card, 'rot', card.target, 90, 0.86, dt);
    ball.update(dt);
    pond.ripples = pond.ripples.map(r => r + dt).filter(r => r < 2.2);
  },
  draw(t) {
    drawSky(-W, -H * 3, W * 3, HORIZON + H * 3, t, 1, 0, 0, 0, HORIZON);
    ctx.drawImage(grass, 0, HORIZON);
    ctx.drawImage(grass, -W, HORIZON); ctx.drawImage(grass, W, HORIZON);
    ctx.fillStyle = '#2a8a5d'; ctx.fillRect(-W, HORIZON + grass.height, W * 3, H * 4);
    // pond
    ctx.save();
    pondPath(t); ctx.fillStyle = waterPattern; ctx.fill(); ctx.clip();
    ctx.strokeStyle = 'rgba(200,220,255,.55)'; ctx.lineWidth = 3;
    for (const r of pond.ripples) {
      for (const lag of [0, 0.25]) {
        const k = r - lag; if (k <= 0) continue;
        ctx.globalAlpha = Math.max(0, 1 - k / 1.8);
        ctx.beginPath();
        ctx.ellipse(ball.x, pond.y - 30, 60 + k * 160, (60 + k * 160) * 0.4, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
    door.draw();
    ball.draw();
    card.draw();
    triangle.draw(t);
  },
};

// =====================================================================
// INSIDE
// =====================================================================
const L = 180, T = 140, R = 1748, B = 978;
const wallPaper = canvas(R - L, B - T, (g, w, h) => {
  g.fillStyle = '#c4513b'; g.fillRect(0, 0, w, h);
  const r = seeded(5);
  for (let i = 0; i < 9000; i++) {
    g.globalAlpha = r() * 0.12;
    g.fillStyle = r() < 0.5 ? '#f08a5a' : '#7a2a20';
    g.fillRect(r() * w, r() * h, 2 + r() * 3, 2 + r() * 3);
  }
  for (let i = 0; i < 40; i++) {
    g.globalAlpha = 0.04; g.fillStyle = '#5a1a10';
    g.fillRect(0, r() * h, w, 1 + r() * 2);
  }
});
const maroon = paper('#9a3a3a', 1400, 256, 21);
const blueWall = paper('#0a6ccb', 600, 256, 22);
const vasePaper = paper('#f59a45', 3500, 128, 23);
const potPaper = paper('#f8f6f1', 900, 256, 24);
const leafPaper = paper('#1f4fb8', 500, 128, 25);

const win = {
  x: 1341, y: 254, w: 243, h: 270, f: 24, glow: 0,
  hit(px, py) { return px > this.x && px < this.x + this.w && py > this.y && py < this.y + this.h; },
  tap() {
    note(880, 0.9); setTimeout(() => note(1175, 1), 120);
    go('out', this.x + this.w / 2, this.y + this.h / 2, '#a9c6ec');
  },
  draw(t) {
    const { x, y, w, h, f } = this;
    ctx.fillStyle = '#a3160f'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#8c120c'; ctx.fillRect(x, y, f + 4, f + 6); ctx.fillRect(x + w - f - 4, y, f + 4, f + 6);
    drawSky(x + f, y + f + 6, w - f * 2, h - f * 2 - 6, t * 1.5, 0.35);
    if (this.glow > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${this.glow * 0.18})`;
      ctx.fillRect(x + f, y + f + 6, w - f * 2, h - f * 2 - 6);
    }
  },
};

const vase = {
  x: 932, y: 822, rot: 0, hit(px, py) { return Math.abs(px - this.x) < 110 && py < this.y && py > this.y - 200; },
  tap() { this.rotV = (this.rotV || 0) + (Math.random() < 0.5 ? -4 : 4); note(587, 0.9, 0.1); },
  draw() {
    ctx.save();
    ctx.translate(this.x, this.y); ctx.rotate(this.rot);
    ctx.beginPath();
    ctx.moveTo(-55, 0);
    ctx.bezierCurveTo(-118, -5, -118, -98, -38, -118);
    ctx.lineTo(-70, -186);
    ctx.lineTo(70, -186);
    ctx.lineTo(38, -118);
    ctx.bezierCurveTo(118, -98, 118, -5, 55, 0);
    ctx.closePath();
    ctx.fillStyle = vasePaper; ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -186, 70, 15, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#fb5f8c'; ctx.fill();
    ctx.restore();
  },
};

// Torn-paper pots. Each can hold a few blue paper leaves.
function tornPot(seed, w, h) {
  const r = seeded(seed), pts = [];
  const ctrl = [[-w / 2, -h], [-w / 2 - 12, -h * 0.75], [-w / 2 + 4, -h * 0.4], [-w / 2 + 22, -h * 0.12],
    [-w / 4, 0], [w / 4, 0], [w / 2 - 18, -h * 0.15], [w / 2 + 8, -h * 0.45], [w / 2 - 10, -h * 0.72], [w / 2, -h]];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const [ax, ay] = ctrl[i], [bx, by] = ctrl[i + 1];
    for (let s = 0; s < 6; s++) {
      const k = s / 6;
      pts.push([ax + (bx - ax) * k + (r() - 0.5) * 3, ay + (by - ay) * k + (r() - 0.5) * 3]);
    }
  }
  // torn top edge
  for (let s = 0; s <= 24; s++) pts.push([w / 2 - (w * s) / 24, -h + (r() - 0.3) * 10]);
  return pts;
}
function leafShape(r) {
  const tall = 140 + r() * 90, lean = (r() - 0.5) * 70;
  return [[-34, 0], [-30 + lean * 0.4, -tall * 0.6], [-6 + lean, -tall], [22 + lean * 0.8, -tall * 0.92], [30, 0]];
}
function makePot(x, y, w, h, seed, leaves) {
  const r = seeded(seed + 100);
  return {
    x, y, w, h, outline: tornPot(seed, w, h), leaves: [], sway: 0, r,
    hit(px, py) { return Math.abs(px - this.x) < this.w / 2 + 10 && py < this.y && py > this.y - this.h - 120; },
    grow() { this.leaves.push({ pts: leafShape(this.r), dx: (this.r() - 0.5) * this.w * 0.5, rot: (this.r() - 0.5) * 0.5, g: 0 }); },
    tap() {
      if (this.leaves.length < 3) { this.grow(); note(392 + this.leaves.length * 98, 1); }
      else note(330, 0.7, 0.1);
      this.swayV = (this.swayV || 0) + 2.2;
    },
    update(dt) {
      for (const l of this.leaves) l.g += (1 - l.g) * Math.min(1, dt * 4);
      spring(this, 'sway', 0, 60, 0.94, dt);
    },
    draw(t) {
      ctx.save();
      ctx.translate(this.x, this.y);
      for (const l of this.leaves) {
        ctx.save();
        ctx.translate(l.dx, -this.h + 20);
        ctx.rotate(l.rot + this.sway * 0.15 + Math.sin(t * 0.8 + l.dx) * 0.02);
        ctx.scale(1, l.g);
        ctx.beginPath(); l.pts.forEach(([a, b], i) => i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)); ctx.closePath();
        ctx.fillStyle = leafPaper; ctx.fill();
        ctx.restore();
      }
      ctx.beginPath(); ctx.ellipse(0, -this.h + 4, this.w / 2, 20, 0, Math.PI, Math.PI * 2);
      ctx.fillStyle = '#f7a3a3'; ctx.fill();
      ctx.beginPath(); this.outline.forEach(([a, b], i) => i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)); ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.save(); ctx.translate(5, 6); ctx.fill(); ctx.restore();
      ctx.fillStyle = potPaper; ctx.fill();
      ctx.restore();
    },
  };
}
const pots = [makePot(345, 1056, 205, 268, 1), makePot(1792, 1032, 210, 335, 2)];
pots[0].grow(); pots[0].leaves[0].g = 1;

function poly(pts, fill) {
  ctx.beginPath(); pts.forEach(([a, b], i) => i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
}
function drawTable() {
  const legs = '#87181d';
  ctx.fillStyle = legs;
  ctx.fillRect(765, 880, 36, 152);   // back left
  ctx.fillRect(1240, 820, 36, 196);  // back right
  poly([[1061, 845], [1282, 762], [1282, 802], [1061, 893]], '#7f161b');
  poly([[603, 845], [782, 768], [1282, 762], [1061, 845]], '#922f33');
  poly([[603, 845], [1061, 845], [1061, 893], [603, 893]], legs);
  ctx.fillStyle = legs;
  ctx.fillRect(603, 893, 36, 165);   // front left
  ctx.fillRect(1034, 893, 36, 170);  // front right
}

const inside = {
  drag: [],
  taps: [vase, ...pots, win],
  update(dt) {
    spring(vase, 'rot', 0, 70, 0.93, dt);
    pots.forEach(p => p.update(dt));
    win.glow += ((win.hover ? 1 : 0) - win.glow) * Math.min(1, dt * 6);
  },
  draw(t) {
    ctx.fillStyle = '#0a6ccb'; ctx.fillRect(-W, -H * 3, W * 3, H * 7);
    poly([[-W, -H * 3], [W * 2, -H * 3], [W * 2, 0], [-W, 0]], maroon);
    poly([[-W, H], [W * 2, H], [W * 2, H * 4], [-W, H * 4]], maroon);
    poly([[0, 0], [W, 0], [R, T], [L, T]], maroon);
    poly([[0, H], [L, B], [R, B], [W, H]], maroon);
    poly([[0, 0], [L, T], [L, B], [0, H]], blueWall);
    poly([[W, 0], [W, H], [R, B], [R, T]], blueWall);
    ctx.drawImage(wallPaper, L, T);
    win.draw(t);
    drawTable();
    vase.draw();
    pots.forEach(p => p.draw(t));
  },
};

// =====================================================================
// scenes, transitions, input
// =====================================================================
let scene = outside, trans = null;
function go(to, fx, fy, color) {
  if (trans) return;
  trans = { t: 0, to: to === 'in' ? inside : outside, fx, fy, color, switched: false };
}

function toStage(e) { return [(e.clientX - ox) / scale, (e.clientY - oy) / scale]; }
function find(px, py) {
  for (const o of scene.drag) if (o.hit(px, py)) return { o, drag: true };
  for (const o of scene.taps) if (o.hit(px, py)) return { o, drag: false };
  return null;
}

let held = null;
cv.addEventListener('pointerdown', e => {
  if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} }
  if (audio && audio.state === 'suspended') audio.resume();
  if (trans) return;
  const [px, py] = toStage(e);
  const f = find(px, py);
  if (!f) return;
  hint.style.opacity = 0;
  cv.setPointerCapture(e.pointerId);
  held = { ...f, sx: px, sy: py, ox: f.o.x - px, oy: (f.o === ball ? ball.base : f.o.y) - py, moved: false };
});
cv.addEventListener('pointermove', e => {
  const [px, py] = toStage(e);
  if (held) {
    if (Math.hypot(px - held.sx, py - held.sy) > 8) held.moved = true;
    if (held.drag && held.moved) {
      held.o.x = Math.max(0, Math.min(W, px + held.ox));
      const ny = Math.max(0, Math.min(H, py + held.oy));
      if (held.o === ball) { ball.base = ny; ball.h = 0; ball.vh = 0; } else held.o.y = ny;
    }
    return;
  }
  const f = trans ? null : find(px, py);
  door.hover = !!f && f.o === door;
  win.hover = !!f && f.o === win;
  cv.style.cursor = f ? (f.drag ? 'grab' : 'pointer') : 'default';
});
const release = () => {
  if (held && !held.moved) held.o.tap();
  if (held && held.o === ball && held.moved) {
    // dropped in the pond? settle onto the water with a splash
    const inPond = ((ball.x - pond.x) / pond.rx) ** 2 + ((ball.base + ball.r - 20 - pond.y) / pond.ry) ** 2 < 1;
    if (inPond) { pond.ripples.push(0); note(165, 0.5); }
  }
  held = null;
};
cv.addEventListener('pointerup', release);
cv.addEventListener('pointercancel', release);
addEventListener('keydown', e => {
  if (e.key === 'Escape' && scene === inside) win.tap();
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  scene.update(dt);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);

  let fade = 0;
  if (trans) {
    trans.t += dt / 1.3;
    const k = trans.t;
    if (k < 0.5) {
      const e = (k / 0.5) ** 2, z = 1 + e * 5;
      ctx.translate(trans.fx, trans.fy); ctx.scale(z, z); ctx.translate(-trans.fx, -trans.fy);
      fade = e;
    } else {
      if (!trans.switched) {
        trans.switched = true; scene = trans.to;
        door.target = 0; door.open = 0; door.openV = 0;
      }
      const e = (k - 0.5) / 0.5, z = 1.15 - 0.15 * (1 - (1 - e) ** 3);
      ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
      fade = 1 - e;
    }
  }
  scene.draw(t);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (fade > 0) {
    ctx.globalAlpha = Math.min(1, fade);
    ctx.fillStyle = trans.color; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.globalAlpha = 1;
  }
  if (trans && trans.t >= 1) trans = null;

  // grain
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.16;
  ctx.translate((Math.random() * 240) | 0, (Math.random() * 240) | 0);
  ctx.scale(dpr, dpr);
  ctx.fillStyle = grainPattern;
  ctx.fillRect(-240, -240, cv.width + 480, cv.height + 480);
  ctx.restore();

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
