// Rooms: places she can be, each with its own lines and doors. A door leads
// to another room; walk up to it and press up to go through. Rooms come in
// three kinds: outside (under the sky), a furnished room, and an empty room
// to draw in. The map (map.js) shows them all and links them up. Used by sketch.js.

let rooms = [];
let roomIndex = 0;
let placingDoor = false;
let pendingDoor = null; // a door just put up, waiting to be told where it goes
let trip = null; // going through a door: { door, t, switched }
let roomCount = 0;

let WALL = [244, 239, 230];
let FLOORBOARDS = [214, 200, 180];
let DOOR_PAPER = [250, 248, 242];
let ROOM_INK = 17;
let doorPhoto = null; // a real door, cut from a film photo and straightened (doors/door.jpg)
let DOOR_PANEL = { x1: 0.075, x2: 0.94, y1: 0.039, y2: 0.99 }; // where the grey panel sits inside its frame
let KIND_NAMES = { outside: "Outside", room: "Room", empty: "Empty room" };

function makeRoom(kind, name, mapAt) {
  roomCount++;
  let r = {
    id: "r" + Date.now().toString(36) + roomCount,
    name: name || KIND_NAMES[kind] + " " + roomCount,
    kind,
    wall: PRESETS[kind].wall,
    floor: PRESETS[kind].floor,
    lines: [],
    doors: [],
    images: [], // photos placed in the world: { x, y, w, h, art }
    fills: [], // colour filled into shapes: { x, y, w, h, art, colour }
    history: [],
    ink: null,
    thumb: null,
    map: mapAt || { x: 40 + (rooms.length % 4) * 280, y: 160 + Math.floor(rooms.length / 4) * 230 },
  };
  rooms.push(r);
  return r;
}

function room() {
  return rooms[roomIndex];
}

function roomById(id) {
  return rooms.find((r) => r.id == id);
}


// a door's size; d.scale makes one bigger or smaller
function doorSize(d) {
  let k = (d && d.scale) || 1;
  return { w: GUY_HEIGHT * 1.25 * (300 / 630) * k, h: GUY_HEIGHT * 1.25 * k };
}

function doorPhotoUrl() {
  return "doors/door.jpg";
}

function loadDoorPhoto() {
  urlToImage(doorPhotoUrl()).then((el) => {
    doorPhoto = createImage(el.naturalWidth, el.naturalHeight);
    doorPhoto.drawingContext.drawImage(el, 0, 0);
    for (let r of rooms) r.ink = null;
    inkDirty = true;
  }, () => {});
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
  };
}

// lines she can stand on that come with the room
function solidLines() {
  let out = [floorLine()];
  if (wallOf() == "room") {
    let L = layout();
    // furniture stands against the back wall: she walks past it, or jumps up onto it
    out.push(platform(seeded([{ x: L.table.x1, y: L.table.top }, { x: L.table.x2, y: L.table.top }], 41)));
    out.push(platform(seeded([{ x: L.chair.x1, y: L.chair.seat }, { x: L.chair.x2, y: L.chair.seat }], 43)));
  }
  return out;
}

// lines that are only drawn: skirting and floorboards indoors, and in a
// furnished room the legs, frames, the lamp, the plant
function roomDrawing() {
  let wall = wallOf();
  if (wall != "room" && wall != "plaster") return [];
  let L = layout();
  let f = floorY();
  let out = [];
  let add = (pts, seed) => out.push(seeded(pts, seed));
  let box = (r, seed) => add(sharp([{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }, { x: r.x, y: r.y - 1 }]), seed);

  // where the wall meets the floor
  let foot = floorOf() == "line" ? f - 9 : horizonY();
  add([{ x: -10, y: foot }, { x: width + 10, y: foot }], 50);
  if (wall != "room") return out;

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
  return room().doors;
}

// ---- drawing the room ----

function drawFurnishings(L) {
  // the sky outside the window, and the world outside in the picture
  // the whole sky, shrunk to fit the window, so its colours all show
  clipTo(L.win, () => {
    translate(L.win.x, L.win.y);
    scale(L.win.w / width, L.win.h / height);
    drawSky();
  });
  clipTo(L.pic, () => {
    push();
    translate(L.pic.x, L.pic.y);
    scale(L.pic.w / width, L.pic.h / height);
    drawSky();
    pop();
    let outside = rooms.find((r) => SKY_WALLS.includes(wallOf(r)));
    if (outside && outside.ink) image(outside.ink, L.pic.x, L.pic.y, L.pic.w, L.pic.h);
  });

  // warm light from the lamp
  let g = drawingContext.createRadialGradient(L.lamp.x, L.lamp.y + 10, 0, L.lamp.x, L.lamp.y + 10, GUY_HEIGHT * 2.2);
  g.addColorStop(0, "rgba(255, 214, 150, 0.45)");
  g.addColorStop(1, "rgba(255, 214, 150, 0)");
  drawingContext.fillStyle = g;
  drawingContext.fillRect(0, 0, width, height);
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

// a door: the photo once it has loaded, until then one drawn in pen
function inkDoor(g, d) {
  let { w, h } = doorSize(d);
  let x = d.x - w / 2;
  let y = d.y - h;
  if (doorPhoto) {
    g.image(doorPhoto, x, y, w, h);
    return;
  }
  g.fill(DOOR_PAPER);
  g.rect(x, y, w, h);
  g.fill(inkHere());
  let seed = d.seed;
  inkLine(g, sharp([{ x, y: d.y }, { x, y }, { x: x + w, y }, { x: x + w, y: d.y }]), seed);
  inkLine(g, sharp([{ x: x + 9, y: y + 10 }, { x: x + w - 9, y: y + 10 }, { x: x + w - 9, y: y + h * 0.42 }, { x: x + 9, y: y + h * 0.42 }, { x: x + 9, y: y + 9 }]), seed + 1);
  inkLine(g, sharp([{ x: x + 9, y: y + h * 0.52 }, { x: x + w - 9, y: y + h * 0.52 }, { x: x + w - 9, y: d.y - 10 }, { x: x + 9, y: d.y - 10 }, { x: x + 9, y: y + h * 0.52 - 1 }]), seed + 2);
  g.circle(x + w - 7, y + h * 0.47, 6);
}


// ---- going through doors ----

function doorNear() {
  if (!guy.onGround || trip) return null;
  return doorsHere().find((d) => abs(guy.x - d.x) < doorSize(d).w * 0.35 && abs(guy.y - d.y) < 12) || portalNear();
}

// ---- portals: a photo or a drawing switched on to lead somewhere, like a door ----

// everything in a place that leads somewhere: its doors and its portals
function exitsOf(r) {
  return [...r.doors, ...r.images.filter((f) => f.portal), ...r.lines.filter((l) => l.portal)];
}

// the box a portal covers; null for a door
function portalBox(p) {
  if (Array.isArray(p)) {
    let xs = p.map((q) => q.x);
    let ys = p.map((q) => q.y);
    return { x: min(xs), y: min(ys), w: max(xs) - min(xs), h: max(ys) - min(ys) };
  }
  return p.w === undefined ? null : { x: p.x, y: p.y, w: p.w, h: p.h };
}

// she's at a portal when she stands in front of it: across its width, and it reaches down to her
function portalNear() {
  let r = room();
  return [...r.images, ...r.lines].reverse().find((p) => {
    if (!p.portal) return false;
    let b = portalBox(p);
    return guy.x > b.x - 6 && guy.x < b.x + b.w + 6 && guy.y > b.y - 4 && guy.y - GUY_HEIGHT < b.y + b.h + 12;
  }) || null;
}

// where she comes out of a portal: under its middle, on whatever is below
function portalArrival(p) {
  let b = portalBox(p);
  let x = b.x + b.w / 2;
  let y = groundBelow(x, b.y + b.h / 2);
  return { x, y: y == null ? floorY() : y };
}

// the bar's Portal switch, shown while a photo or a drawing is selected
function syncPortalButton() {
  let it = tool == "select" && selected && stillHere(selected) && selected.kind != "door" ? selected.item : null;
  let to = it && it.portal && roomById(it.to);
  let label = !it ? "" : !it.portal ? "Off" : to ? "To " + to.name : "On";
  if (label == syncPortalButton.last) return;
  syncPortalButton.last = label;
  let button = document.getElementById("portalButton");
  button.hidden = !it;
  button.classList.toggle("on", !!(it && it.portal));
  document.getElementById("portalLabel").textContent = label;
}

function togglePortal() {
  if (!selected || selected.kind == "door") return;
  pushUndo();
  let it = selected.item;
  if (it.portal) {
    it.portal = false;
    it.to = null;
  } else {
    it.portal = true;
    it.to = null;
    pendingDoor = it;
    askWhereDoorGoes("Where does this portal go?");
  }
  syncPortalButton.last = null;
  inkDirty = true;
  saveWorld();
}

function goThrough(door) {
  if (!door.to || !roomById(door.to)) {
    pendingDoor = door;
    askWhereDoorGoes(portalBox(door) ? "This portal doesn't lead anywhere yet. Where should it go?" : "This door doesn't lead anywhere yet. Where should it go?");
    return;
  }
  snapshotRoom(); // before the door opens, while the room looks itself
  trip = { door, t: 0, switched: false };
}

// the door swinging open, drawn behind her so she steps into the doorway
function drawOpening() {
  if (!trip || portalBox(trip.door)) return; // a portal has no door to open: she just fades through
  let d = trip.door;
  let { w, h } = doorSize(d);
  if (!trip.switched && doorPhoto) {
    // the grey panel swings in on its hinges, leaving the dark doorway in its frame
    let open = constrain(trip.t / 0.35, 0, 1);
    let P = DOOR_PANEL;
    let px = d.x - w / 2 + P.x1 * w;
    let py = d.y - h + P.y1 * h;
    let pw = (P.x2 - P.x1) * w;
    let ph = (P.y2 - P.y1) * h;
    noStroke();
    fill(24, 22, 22);
    rect(px, py, pw, ph);
    let src = { x: P.x1 * doorPhoto.width, y: P.y1 * doorPhoto.height, w: (P.x2 - P.x1) * doorPhoto.width, h: (P.y2 - P.y1) * doorPhoto.height };
    image(doorPhoto, px, py, pw * (1 - open * 0.85), ph, src.x, src.y, src.w, src.h);
    fill(0, open * 60);
    rect(px, py, pw * (1 - open * 0.85), ph);
  } else if (!trip.switched) {
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

}

// fade out, change rooms, fade in
function drawTrip() {
  if (!trip) return;
  trip.t += deltaTime / 1000;
  let d = trip.door;

  let fade = 0;
  if (trip.t < 0.35) fade = 0;
  else if (trip.t < 0.65) fade = (trip.t - 0.35) / 0.3;
  else fade = 1 - (trip.t - 0.65) / 0.35;
  fill(250, 248, 242, constrain(fade, 0, 1) * 255);
  rect(0, 0, width, height);

  if (trip.t >= 0.65 && !trip.switched) {
    trip.switched = true;
    enterRoom(rooms.indexOf(roomById(d.to)), room().id);
  }
  if (trip.t >= 1) trip = null;
}

// she arrives at the door that leads back where she came from, if there is one
// a place's wall decides its photo and the sky its window shows
function enterWorld() {
  let r = room();
  if (wallOf(r) == "photo") useOwnPhoto(r.skyPhoto);
  if (SKY_WALLS.includes(wallOf(r))) setSkyName(wallOf(r));
  document.body.dataset.room = r.id;
  markWorld();
}

function enterRoom(i, fromId) {
  selected = null;
  roomIndex = i;
  settle(room());
  lines = room().lines;
  inkDirty = true;
  let back = exitsOf(room()).find((d) => d.to == fromId) || (fromId == null && room().doors[0]);
  let arrive = back ? (portalBox(back) ? portalArrival(back) : back) : { x: 120, y: floorY() };
  guy.x = constrain(arrive.x, 20, width - 20);
  guy.y = arrive.y;
  guy.vy = 0;
  guy.onGround = true;
  guy.angle = 0;
  guy.stride = 0;
  enterWorld();
  saveWorld();
}

// a little pen arrow over a door she's standing at
function drawDoorHint() {
  let d = doorNear();
  if (!d) return;
  let b = portalBox(d);
  let x = b ? b.x + b.w / 2 : d.x;
  let top = b ? b.y : d.y - doorSize(d).h;
  let y = max(top - 18, 40) + sin(frameCount * 0.1) * 3;
  stroke(inkHere());
  strokeWeight(2.5);
  noFill();
  line(x, y, x, y - 18);
  line(x - 7, y - 11, x, y - 18);
  line(x + 7, y - 11, x, y - 18);
  noStroke();
}

function placeDoor(x, y) {
  let base = groundBelow(x, y - 30);
  if (base == null) base = floorY();
  let d = { x: constrain(x, doorSize().w / 2, width - doorSize().w / 2), y: base, floor: base >= floorY() - 2, seed: random(1000), to: null };
  room().doors.push(d);
  room().history.push("door");
  inkDirty = true;
  setPlacingDoor(false);
  pendingDoor = d;
  askWhereDoorGoes("Where does this door go?");
  saveWorld();
}

// ---- where doors go ----

function askWhereDoorGoes(question) {
  document.getElementById("doorQuestion").textContent = question;
  document.getElementById("doorChoice").hidden = false;
}

function closeDoorChoice() {
  document.getElementById("doorChoice").hidden = true;
}

// a new room behind the pending door, with a door of its own leading back
function linkToNewRoom(kind) {
  let from = room();
  let card = from.map;
  let r = makeRoom(kind, null, freeMapSpot(card.x + 280, card.y));
  if (pendingDoor) linkDoor(pendingDoor, r);
  pendingDoor = null;
  closeDoorChoice();
  saveWorld();
  return r;
}

function linkDoor(door, target) {
  door.to = target.id;
  let home = rooms.find((r) => exitsOf(r).includes(door));
  if (home && !exitsOf(target).some((d) => d.to == home.id)) {
    let x = max(width * 0.1, doorSize().w / 2 + 12) + target.doors.length * doorSize().w * 1.4;
    target.doors.push({ x, y: groundOf(target), floor: true, seed: random(1000), to: home.id });
    target.ink = null;
  }
  inkDirty = true;
}

function freeMapSpot(x, y) {
  let taken = (px, py) => rooms.some((r) => abs(r.map.x - px) < 230 && abs(r.map.y - py) < 200);
  for (let tries = 0; tries < 40 && taken(x, y); tries++) {
    y += 230;
    if (tries % 3 == 2) {
      x += 280;
      y -= 690;
    }
  }
  return { x, y };
}

// a small picture of the room for the map
function snapshotRoom() {
  if (!room() || !width) return;
  let c = document.createElement("canvas");
  c.width = 320;
  c.height = round((320 * height) / width);
  c.getContext("2d").drawImage(document.querySelector("canvas"), 0, 0, c.width, c.height);
  try {
    room().thumb = c.toDataURL("image/jpeg", 0.7);
  } catch (e) {}
}

// ---- keeping the world in this browser ----

// saved in IndexedDB, which has room for photos and art; older saves in localStorage are still read
function saveWorld() {
  clearTimeout(saveWorld.timer);
  saveWorld.timer = setTimeout(async () => {
    let world = {
      at: room().id,
      count: roomCount,
      rooms: rooms.map((r) => ({
        id: r.id, name: r.name, kind: r.kind, wall: r.wall, floor: r.floor, skyPhoto: r.skyPhoto, floorPhoto: r.floorPhoto, map: r.map, thumb: r.thumb, doors: r.doors,
        images: r.images.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, art: f.art, portal: f.portal, to: f.to })),
        fills: r.fills.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, art: f.art, colour: f.colour })),
        lines: r.lines.map((l) => ({ seed: l.seed, colour: l.colour, sharp: l.sharp, portal: l.portal, to: l.to, pts: l.map((p) => [round(p.x), round(p.y)]) })),
      })),
    };
    try {
      let db = await openStore();
      db.transaction("saved", "readwrite").objectStore("saved").put(world, "world");
    } catch (e) {
      showStatus("Couldn't save in this browser, so changes will be lost when you leave.", 5000);
    }
  }, 400);
}

// starts with one outside straight away, then swaps in the saved world once it's read
function loadWorld() {
  makeRoom("outside", "Outside");
  lines = room().lines;
  readWorld().then((world) => {
    if (world && world.rooms && world.rooms.length) useWorld(world);
  });
}

async function readWorld() {
  try {
    let db = await openStore();
    let world = await new Promise((done) => {
      let req = db.transaction("saved").objectStore("saved").get("world");
      req.onsuccess = () => done(req.result || null);
      req.onerror = () => done(null);
    });
    if (world) return world;
  } catch (e) {}
  try {
    return JSON.parse(localStorage.getItem("walk-world"));
  } catch (e) {
    return null;
  }
}

// doors standing on the floor stay on it when the window changes size,
// and anything left below the floor or off to the side is brought back within reach
function settle(r) {
  let f = groundOf(r);
  for (let d of r.doors) {
    if (d.floor || d.y >= f - 2) {
      d.floor = true;
      d.y = f;
    }
    d.x = constrain(d.x, 20, width - 20);
  }
}

function useWorld(world) {
  rooms = world.rooms.map(({ things, frames, texts, sky, ...r }) => ({
    ...r,
    // older worlds had kinds and one sky per outside: an outside keeps its sky and its line,
    // a furnished room its room on boards, an empty room plaster on boards
    wall: r.wall || (r.kind == "outside" ? (WALLS[sky] ? sky : "day") : r.kind == "room" ? "room" : "plaster"),
    floor: r.floor || (r.kind == "outside" ? "line" : "boards"),
    // older worlds kept photos and art as frames; anything with a picture carries over as an image
    images: r.images || (frames || []).filter((f) => f.art).map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, art: f.art })),
    fills: r.fills || [],
    history: [],
    ink: null,
    lines: r.lines.map((l) => Object.assign(seeded(l.pts.map(([x, y]) => ({ x, y })), l.seed), l.colour ? { colour: l.colour } : {}, l.sharp ? { sharp: true } : {}, l.portal ? { portal: true, to: l.to || null } : {})),
  }));
  roomCount = world.count || rooms.length;
  roomIndex = max(0, rooms.findIndex((r) => r.id == world.at));
  lines = room().lines;
  for (let r of rooms) settle(r);
  inkDirty = true;
  enterWorld();
  guy.y = -GUY_HEIGHT; // drops in from the top
  guy.onGround = false;
}

function setPlacingDoor(on) {
  setTool(on ? "door" : "draw");
}
