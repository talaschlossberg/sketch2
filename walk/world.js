// World: every page is a wall and a floor. The wall is a painted sky, your own
// photo, plaster, or the furnished room; the floor is grass, sand, boards,
// tiles, concrete, clay, or just the drawn line. Floors are painted in
// perspective down from a horizon, and she walks a little below it, with a
// soft shadow on the ground. Used by sketch.js.

let WALLS = {
  blue: { label: "Blue" },
  day: { label: "Clouds" },
  sunset: { label: "Sunset" },
  night: { label: "Night", ink: 240 },
  photo: { label: "Your photo" },
  plaster: { label: "Plaster" },
  room: { label: "Room" },
};
let SKY_WALLS = ["blue", "day", "sunset", "night", "photo"];

// base colour near the horizon and near the viewer, and the flecks scattered on it
let FLOORS = {
  line: { label: "Line" },
  grass: { label: "Grass", far: [86, 152, 112], near: [108, 180, 135], flecks: [[70, 130, 92], [150, 205, 165], [60, 115, 80]] },
  sand: { label: "Sand", far: [204, 182, 140], near: [228, 208, 170], flecks: [[180, 155, 112], [240, 226, 196], [160, 135, 98]] },
  boards: { label: "Boards", far: [190, 160, 120], near: [214, 188, 150] },
  tiles: { label: "Tiles", far: [214, 210, 198], near: [238, 234, 224] },
  concrete: { label: "Concrete", far: [160, 157, 151], near: [188, 185, 179], flecks: [[130, 127, 122], [210, 207, 200], [110, 108, 104]] },
  clay: { label: "Clay", far: [176, 92, 56], near: [206, 120, 80], flecks: [[150, 74, 44], [226, 150, 110], [130, 62, 36]] },
};

let PRESETS = {
  outside: { wall: "blue", floor: "grass" },
  room: { wall: "room", floor: "boards" },
  empty: { wall: "plaster", floor: "boards" },
};

let worldLayer = null;
let worldKey = "";

function wallOf(r = room()) {
  return WALLS[r.wall] ? r.wall : "day";
}

function floorOf(r = room()) {
  return FLOORS[r.floor] ? r.floor : "line";
}

// where the floor meets the wall, and the line she walks on, in a box h tall
function horizonFor(floor, h) {
  return floor == "line" ? h - FLOOR_GAP : round(h * 0.6);
}

function groundFor(floor, h) {
  return floor == "line" ? h - FLOOR_GAP : round(h * 0.7);
}

function groundOf(r) {
  return groundFor(floorOf(r), height);
}

function horizonY() {
  return horizonFor(floorOf(), height);
}

function inkHere() {
  return WALLS[wallOf()].ink || ROOM_INK;
}

// ---- painting ----

function paintWall(g, wall) {
  if (SKY_WALLS.includes(wall)) return paintSkyInto(g, wall);
  // plaster: warm and a little uneven, like a painted studio wall
  g.background(WALL);
  g.noStroke();
  for (let i = 0; i < 70; i++) {
    let x = noise(i * 3.1) * g.width;
    let y = noise(i * 7.7 + 40) * g.height;
    g.fill(255, 250, 240, 18);
    g.circle(x, y, g.width * (0.15 + noise(i) * 0.3));
  }
}

// rows of the floor in perspective: depth 0 at the horizon, 1 at the bottom edge
function paintFloor(g, kind, hz) {
  let F = FLOORS[kind];
  if (!F.far) return;
  let h = g.height - hz;
  if (h <= 0) return;
  g.noStroke();
  for (let y = hz; y < g.height; y++) {
    let t = (y - hz) / h;
    g.fill(lerp(F.far[0], F.near[0], t), lerp(F.far[1], F.near[1], t), lerp(F.far[2], F.near[2], t));
    g.rect(0, y, g.width, 1.5);
  }
  g.noStroke();
  randomSeed(7);
  if (F.flecks) {
    // flecks finer and denser toward the horizon, as on a real ground
    let count = (g.width * h) / 26;
    for (let i = 0; i < count; i++) {
      let t = pow(random(), 1.7);
      let y = hz + t * h;
      let s = 0.4 + t * 2.4;
      let c = random(F.flecks);
      g.fill(c[0], c[1], c[2], 150);
      g.rect(random(g.width), y, s, s * 0.7);
    }
  }
  let vx = g.width / 2;
  if (kind == "boards") {
    // planks running away from her, joints across them here and there
    g.stroke(150, 120, 86, 150);
    g.strokeWeight(1);
    let n = 22;
    for (let i = -n; i <= n; i++) {
      let bx = vx + (i * g.width) / 9;
      g.line(vx + (bx - vx) * 0.02, hz, bx, g.height);
    }
    g.strokeWeight(0.8);
    for (let i = 0; i < 160; i++) {
      let t = pow(random(), 1.4);
      let y = hz + t * h;
      let lane = floor(random(-n, n));
      let x0 = vx + ((lane * g.width) / 9) * (0.02 + 0.98 * t);
      let x1 = vx + (((lane + 1) * g.width) / 9) * (0.02 + 0.98 * t);
      g.line(x0, y, x1, y);
    }
  }
  if (kind == "tiles") {
    // square tiles: lines to the vanishing point, and rows spaced by depth
    g.stroke(160, 158, 150, 170);
    g.strokeWeight(1);
    let n = 30;
    let size = g.width / 11;
    for (let i = -n; i <= n; i++) g.line(vx, hz, vx + i * size * 1.0, g.height + h * 0.001);
    let near = 1;
    for (let z = near; z < 60; z += 0.45) {
      let y = hz + h * (near / z);
      if (y - hz < 1) break;
      g.line(0, y, g.width, y);
    }
  }
  g.noStroke();
  g.strokeWeight(1);
  // haze where the floor meets the wall
  let haze = g.drawingContext.createLinearGradient(0, hz, 0, hz + h * 0.18);
  haze.addColorStop(0, "rgba(255, 255, 255, 0.16)");
  haze.addColorStop(1, "rgba(255, 255, 255, 0)");
  g.drawingContext.fillStyle = haze;
  g.drawingContext.fillRect(0, hz, g.width, h * 0.18);
  randomSeed(millis());
}

function paintWorldInto(g, wall, floor) {
  g.clear();
  g.strokeWeight(1);
  paintWall(g, wall);
  paintFloor(g, floor, horizonFor(floor, g.height));
}

function drawWorld() {
  let wall = wallOf();
  let floor = floorOf();
  let key = [wall, floor, width, height, ownPhotoSrc, !!photoForSky()].join("|");
  if (!worldLayer || worldKey != key) {
    if (!worldLayer || worldLayer.width != width || worldLayer.height != height) worldLayer = createGraphics(width, height);
    if (!grain || grain.width != width || grain.height != height) grain = makeGrain(width, height);
    paintWorldInto(worldLayer, wall, floor);
    worldKey = key;
  }
  image(worldLayer, 0, 0, width, height);

  // drifting clouds, above the horizon only
  if (wall == "day" || wall == "sunset") {
    let clouds = cloudsFor(wall);
    cloudDrift = (cloudDrift + 0.15) % clouds.width;
    clipTo({ x: 0, y: 0, w: width, h: horizonY() }, () => {
      image(clouds, -cloudDrift, 0, clouds.width, height);
      image(clouds, clouds.width - cloudDrift, 0, clouds.width, height);
    });
  }
  if (wall == "room") drawFurnishings(layout());
  if (wall != "photo" || floorOf() != "line") image(grain, 0, 0, width, height);
}

// a soft shadow on whatever is under her, smaller and fainter the higher she is
function drawShadow() {
  if (!walker) return;
  let below = groundBelow(guy.x, guy.y - 2);
  if (below == null) return;
  let k = 1 / (1 + max(0, below - guy.y) / 120);
  let w = GUY_HEIGHT * 0.5 * k;
  let h = GUY_HEIGHT * 0.07 * k;
  push();
  translate(guy.x, below + 1);
  scale(1, h / w);
  let shade = drawingContext.createRadialGradient(0, 0, 0, 0, 0, w / 2);
  shade.addColorStop(0, `rgba(20, 24, 22, ${0.42 * k})`);
  shade.addColorStop(1, "rgba(20, 24, 22, 0)");
  drawingContext.fillStyle = shade;
  drawingContext.beginPath();
  drawingContext.arc(0, 0, w / 2, 0, TWO_PI);
  drawingContext.fill();
  pop();
}

// ---- choosing ----

function chooseWall(name) {
  let r = room();
  r.wall = name;
  if (SKY_WALLS.includes(name)) setSkyName(name); // rooms look out on the last sky picked
  if (name == "photo") useOwnPhoto(r.skyPhoto);
  r.ink = null;
  inkDirty = true;
  markWorld();
  saveWorld();
}

function chooseFloor(name) {
  let r = room();
  let wasOnFloor = guy.onGround && abs(guy.y - floorY()) < 1;
  r.floor = name;
  settle(r);
  if (wasOnFloor) guy.y = floorY();
  r.ink = null;
  inkDirty = true;
  markWorld();
  saveWorld();
}

function markWorld() {
  let wall = wallOf();
  let floor = floorOf();
  document.getElementById("wallLabel").textContent = WALLS[wall].label;
  document.getElementById("floorLabel").textContent = FLOORS[floor].label;
  for (let b of document.querySelectorAll("#wallPicker [data-wall]")) b.classList.toggle("on", b.dataset.wall == wall);
  for (let b of document.querySelectorAll("#floorPicker [data-floor]")) b.classList.toggle("on", b.dataset.floor == floor);
  document.getElementById("changePhoto").hidden = wall != "photo";
  document.body.dataset.wall = wall;
}

// little pictures of each wall over this floor, and each floor under this wall
function paintPreviews() {
  let make = (cv, wall, floor) => {
    let g = createGraphics(120, 76);
    g.pixelDensity(1);
    paintWorldInto(g, wall, floor);
    if (wall == "room") {
      g.noStroke();
      g.fill(160, 190, 215);
      g.rect(68, 10, 30, 22);
      g.stroke(40);
      g.noFill();
      g.rect(68, 10, 30, 22);
    }
    cv.getContext("2d").drawImage(g.elt, 0, 0, cv.width, cv.height);
    g.remove();
  };
  for (let cv of document.querySelectorAll("#wallPicker canvas")) make(cv, cv.dataset.wall, floorOf());
  for (let cv of document.querySelectorAll("#floorPicker canvas")) make(cv, wallOf(), cv.dataset.floor);
}

function hookWorld() {
  let fill = (picker, list, attr, choose) => {
    for (let name in list) {
      let b = document.createElement("button");
      b.className = "world-pick";
      b.dataset[attr] = name;
      let cv = document.createElement("canvas");
      cv.width = 120;
      cv.height = 76;
      cv.dataset[attr] = name;
      let label = document.createElement("span");
      label.textContent = list[name].label;
      b.append(cv, label);
      b.onclick = () => {
        choose(name);
        picker.hidden = true;
      };
      picker.appendChild(b);
    }
  };
  let walls = document.getElementById("wallPicker");
  let floors = document.getElementById("floorPicker");
  fill(walls, WALLS, "wall", chooseWall);
  fill(floors, FLOORS, "floor", chooseFloor);
  let open = (picker, other, button) => {
    other.hidden = true;
    picker.hidden = !picker.hidden;
    if (!picker.hidden) {
      let r = button.getBoundingClientRect();
      picker.style.left = r.left + "px";
      paintPreviews();
    }
  };
  document.getElementById("wallButton").onclick = (e) => open(walls, floors, e.currentTarget);
  document.getElementById("floorButton").onclick = (e) => open(floors, walls, e.currentTarget);
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest("#wallPicker, #floorPicker, #wallButton, #floorButton")) walls.hidden = floors.hidden = true;
  });
  let input = document.getElementById("skyPhotoInput");
  document.getElementById("changePhoto").onclick = () => input.click();
  input.onchange = () => {
    if (input.files[0]) setOwnPhoto(input.files[0]);
    input.value = "";
  };
  markWorld();
}
