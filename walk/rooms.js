// Rooms: outside under the sky, and the room behind any door you put up.
// Each room keeps its own lines and doors. Walk up to a door and press up
// to go through. Used by sketch.js.

let rooms = [
  { name: "outside", lines: [], doors: [], history: [], ink: null },
  { name: "room", lines: [], doors: [], history: [], ink: null },
];
let roomIndex = 0;
let placingDoor = false;
let lastDoorOutside = null; // the door she went in by, so she comes back out of it
let trip = null; // going through a door: { door, t, switched }

let WALL = [244, 239, 230];
let FLOORBOARDS = [214, 200, 180];
let DOOR_PAPER = [250, 248, 242];
let ROOM_INK = 17;

function room() {
  return rooms[roomIndex];
}

function doorSize() {
  return { w: GUY_HEIGHT * 0.55, h: GUY_HEIGHT * 1.22 };
}

// ---- the room's layout, worked out from the window size ----

function layout() {
  let w = width;
  let f = floorY();
  let H = GUY_HEIGHT;
  return {
    win: { x: w * 0.55, y: height * 0.14, w: w * 0.25, h: height * 0.34 },
    pic: { x: w * 0.25, y: height * 0.22, w: max(80, w * 0.12), h: max(64, height * 0.15) },
    table: { x1: w * 0.57, x2: w * 0.79, top: f - H * 0.45 },
    chair: { x1: w * 0.45, x2: w * 0.52, seat: f - H * 0.3, back: f - H * 0.78 },
    lamp: { x: w * 0.68, y: height * 0.3 },
    plant: { x: w * 0.9 },
    door: { x: max(w * 0.1, doorSize().w / 2 + 12), y: f, fixed: true, seed: 31 },
  };
}

// lines she can stand on that come with the room
function solidLines() {
  let out = [floorLine()];
  if (roomIndex == 1) {
    let L = layout();
    // furniture stands against the back wall: she walks past it, or jumps up onto it
    out.push(platform(seeded([{ x: L.table.x1, y: L.table.top }, { x: L.table.x2, y: L.table.top }], 41)));
    out.push(platform(seeded([{ x: L.chair.x1, y: L.chair.seat }, { x: L.chair.x2, y: L.chair.seat }], 43)));
  }
  return out;
}

// lines that are only drawn: legs, frames, the lamp, the plant
function roomDrawing() {
  let L = layout();
  let f = floorY();
  let out = [];
  let add = (pts, seed) => out.push(seeded(pts, seed));
  let box = (r, seed) => add(sharp([{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }, { x: r.x, y: r.y - 1 }]), seed);

  // skirting board and floorboards
  add([{ x: -10, y: f - 9 }, { x: width + 10, y: f - 9 }], 50);
  for (let i = 1; i < 4; i++) {
    let y = f + (height - f) * (i * i) / 12;
    add([{ x: -10, y }, { x: width + 10, y: y + 1 }], 60 + i);
  }

  // window with its cross bars and sill
  let win = L.win;
  box(win, 70);
  add([{ x: win.x + win.w / 2, y: win.y }, { x: win.x + win.w / 2, y: win.y + win.h }], 71);
  add([{ x: win.x, y: win.y + win.h * 0.45 }, { x: win.x + win.w, y: win.y + win.h * 0.45 }], 72);
  add([{ x: win.x - 10, y: win.y + win.h + 7 }, { x: win.x + win.w + 10, y: win.y + win.h + 7 }], 73);

  // picture frame
  box(L.pic, 80);
  box({ x: L.pic.x - 6, y: L.pic.y - 6, w: L.pic.w + 12, h: L.pic.h + 12 }, 81);

  // table legs
  let t = L.table;
  add([{ x: t.x1 + 10, y: t.top }, { x: t.x1 + 12, y: f }], 90);
  add([{ x: t.x2 - 10, y: t.top }, { x: t.x2 - 12, y: f }], 91);

  // chair: back, legs
  let c = L.chair;
  add([{ x: c.x1, y: c.back }, { x: c.x1, y: f }], 100);
  add([{ x: c.x2, y: c.seat }, { x: c.x2, y: f }], 101);
  add([{ x: c.x1, y: c.back + 14 }, { x: c.x1 + 16, y: c.back + 12 }], 102);

  // lamp hanging over the table
  let lamp = L.lamp;
  add([{ x: lamp.x, y: -5 }, { x: lamp.x, y: lamp.y - 26 }], 110);
  add(sharp([{ x: lamp.x - 10, y: lamp.y - 26 }, { x: lamp.x + 10, y: lamp.y - 26 }, { x: lamp.x + 26, y: lamp.y }, { x: lamp.x - 26, y: lamp.y }, { x: lamp.x - 10, y: lamp.y - 27 }]), 111);

  // plant in a pot
  let p = L.plant.x;
  let potTop = f - GUY_HEIGHT * 0.3;
  add(sharp([{ x: p - 22, y: potTop }, { x: p + 22, y: potTop }, { x: p + 16, y: f }, { x: p - 16, y: f }, { x: p - 22, y: potTop - 1 }]), 120);
  let leaves = [[-50, -95], [-20, -130], [8, -150], [34, -118], [56, -80], [-38, -60], [40, -50]];
  leaves.forEach(([dx, dy], i) => {
    let s = GUY_HEIGHT / 160;
    add([{ x: p, y: potTop }, { x: p + dx * 0.4 * s, y: potTop + dy * 0.55 * s }, { x: p + dx * s, y: potTop + dy * s }], 130 + i);
  });
  return out;
}

function sharp(pts) {
  pts.sharp = true;
  return pts;
}

function platform(pts) {
  pts.platform = true;
  return pts;
}

function seeded(pts, seed) {
  pts.seed = seed;
  return pts;
}

function doorsHere() {
  if (roomIndex == 1) return [layout().door, ...room().doors];
  return room().doors;
}

// ---- drawing the room ----

function drawRoom() {
  let L = layout();
  background(WALL);
  noStroke();
  fill(FLOORBOARDS);
  rect(0, floorY(), width, height - floorY());

  // the sky outside the window, and the world outside in the picture
  // the whole sky, shrunk to fit the window, so its colours all show
  clipTo(L.win, () => {
    translate(L.win.x, L.win.y);
    scale(L.win.w / width, L.win.h / height);
    drawSky();
  });
  clipTo(L.pic, () => {
    if (!skyLayer || skyLayer.width != width) paintSky();
    image(skyLayer, L.pic.x, L.pic.y, L.pic.w, L.pic.h);
    if (rooms[0].ink) image(rooms[0].ink, L.pic.x, L.pic.y, L.pic.w, L.pic.h);
  });

  // warm light from the lamp
  let g = drawingContext.createRadialGradient(L.lamp.x, L.lamp.y + 10, 0, L.lamp.x, L.lamp.y + 10, GUY_HEIGHT * 2.2);
  g.addColorStop(0, "rgba(255, 214, 150, 0.45)");
  g.addColorStop(1, "rgba(255, 214, 150, 0)");
  drawingContext.fillStyle = g;
  drawingContext.fillRect(0, 0, width, height);

  if (grain) image(grain, 0, 0, width, height);
}

function clipTo(r, paint) {
  push();
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.rect(r.x, r.y, r.w, r.h);
  drawingContext.clip();
  paint();
  drawingContext.restore();
  pop();
}

// a door: paper-coloured, two panels and a knob, drawn in pen
function inkDoor(g, d) {
  let { w, h } = doorSize();
  let x = d.x - w / 2;
  let y = d.y - h;
  g.fill(DOOR_PAPER);
  g.rect(x, y, w, h);
  g.fill(inkHere());
  let seed = d.seed;
  inkLine(g, sharp([{ x, y: d.y }, { x, y }, { x: x + w, y }, { x: x + w, y: d.y }]), seed);
  inkLine(g, sharp([{ x: x + 9, y: y + 10 }, { x: x + w - 9, y: y + 10 }, { x: x + w - 9, y: y + h * 0.42 }, { x: x + 9, y: y + h * 0.42 }, { x: x + 9, y: y + 9 }]), seed + 1);
  inkLine(g, sharp([{ x: x + 9, y: y + h * 0.52 }, { x: x + w - 9, y: y + h * 0.52 }, { x: x + w - 9, y: d.y - 10 }, { x: x + 9, y: d.y - 10 }, { x: x + 9, y: y + h * 0.52 - 1 }]), seed + 2);
  g.circle(x + w - 7, y + h * 0.47, 6);
}

function inkHere() {
  return roomIndex == 0 ? inkColour() : ROOM_INK;
}

// ---- going through doors ----

function doorNear() {
  if (!guy.onGround || trip) return null;
  let { w } = doorSize();
  return doorsHere().find((d) => abs(guy.x - d.x) < w * 0.35 && abs(guy.y - d.y) < 12) || null;
}

function goThrough(door) {
  trip = { door, t: 0, switched: false };
}

// door opening, fade out, change rooms, fade in
function drawTrip() {
  if (!trip) return;
  trip.t += deltaTime / 1000;
  let { w, h } = doorSize();
  let d = trip.door;

  if (!trip.switched) {
    let open = constrain(trip.t / 0.35, 0, 1);
    noStroke();
    fill(28, 24, 22);
    rect(d.x - w / 2, d.y - h, w, h);
    fill(DOOR_PAPER);
    stroke(inkHere());
    strokeWeight(2.5);
    let panel = w * (1 - open * 0.85);
    quad(d.x - w / 2, d.y - h, d.x - w / 2 + panel, d.y - h - open * 8, d.x - w / 2 + panel, d.y + open * 8, d.x - w / 2, d.y);
    noStroke();
  }

  let fade = 0;
  if (trip.t < 0.35) fade = 0;
  else if (trip.t < 0.65) fade = (trip.t - 0.35) / 0.3;
  else fade = 1 - (trip.t - 0.65) / 0.35;
  fill(250, 248, 242, constrain(fade, 0, 1) * 255);
  rect(0, 0, width, height);

  if (trip.t >= 0.65 && !trip.switched) {
    trip.switched = true;
    if (roomIndex == 0) {
      lastDoorOutside = d;
      enterRoom(1);
    } else {
      enterRoom(0);
    }
  }
  if (trip.t >= 1) trip = null;
}

function enterRoom(i) {
  roomIndex = i;
  lines = room().lines;
  inkDirty = true;
  let arrive = i == 1 ? layout().door : lastDoorOutside || { x: 120, y: floorY() };
  guy.x = arrive.x;
  guy.y = arrive.y;
  guy.vy = 0;
  guy.onGround = true;
  guy.angle = 0;
  guy.stride = 0;
  document.body.dataset.room = room().name;
}

// a little pen arrow over a door she's standing at
function drawDoorHint() {
  let d = doorNear();
  if (!d) return;
  let { h } = doorSize();
  let y = d.y - h - 18 + sin(frameCount * 0.1) * 3;
  stroke(roomIndex == 0 ? inkColour() : ROOM_INK);
  strokeWeight(2.5);
  noFill();
  line(d.x, y, d.x, y - 18);
  line(d.x - 7, y - 11, d.x, y - 18);
  line(d.x + 7, y - 11, d.x, y - 18);
  noStroke();
}

function placeDoor(x, y) {
  let base = groundBelow(x, y - 30);
  if (base == null) base = floorY();
  let d = { x: constrain(x, doorSize().w / 2, width - doorSize().w / 2), y: base, seed: random(1000) };
  room().doors.push(d);
  room().history.push("door");
  inkDirty = true;
  setPlacingDoor(false);
}

function setPlacingDoor(on) {
  placingDoor = on;
  document.getElementById("door").classList.toggle("on", on);
  if (on) showStatus("Click on a line to put the door there.");
  else document.getElementById("status").hidden = true;
}
