// Walk: draw lines, then walk her along them with the arrow keys.
// Her frames are walk/frames/walk01.png ... walk22.png, from walk_cycle.mov, facing right;
// frames.js works out how far each one travels.

let FRAME_COUNT = 22;
let MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'; // as in PMT

let walker = null; // what prepareFrames returns
let drawnFacing = 1; // her frames face right
let framesFailed = false;

let lines = []; // the lines drawn in the room she's in: lists of {x, y} points, plus a seed for its wobble
let drawing = null;
let FLOOR_GAP = 40; // the floor runs along the bottom of the window, this far up
let inkDirty = true; // each room's lines are drawn once into its own layer, and again only when they change

let guy = {
  x: 120,
  y: 0, // y of his feet
  vy: 0,
  facing: 1,
  onGround: false,
  stride: 0, // distance walked, drives the frame
  angle: 0, // tilt to match the slope under his feet
};

let GUY_HEIGHT = 160;
let SPEED = 2;
let GRAVITY = 0.6;
let JUMP = 11;
let STEP_UP = 18; // tallest bump he can step onto without jumping

let held = { left: false, right: false, up: false };
let upTapped = false; // a quick tap of up can fall between two frames, so it's caught here too

// p5's loadImage fetches the file first, which some hosts block,
// so frames are loaded as plain images and copied into p5 images
async function loadFrames() {
  try {
    let els = [];
    for (let n = 1; n <= FRAME_COUNT; n++) els.push(await urlToImage(frameUrl(n)));
    walker = prepareFrames(els);
  } catch (e) {
    framesFailed = true;
  }
}

function urlToImage(url) {
  return new Promise((done, fail) => {
    let el = new Image();
    el.onload = () => done(el);
    el.onerror = fail;
    el.src = url;
  });
}

function frameUrl(n) {
  return "frames/walk" + String(n).padStart(2, "0") + ".png";
}


// a message along the bottom; tips (with a key) closed with the × don't come back
function showStatus(text, ms, key) {
  if (key && closedTips().includes(key)) return;
  let el = document.getElementById("status");
  document.getElementById("statusText").textContent = text;
  el.dataset.key = key || "";
  el.hidden = false;
  clearTimeout(showStatus.timer);
  if (ms) showStatus.timer = setTimeout(() => (el.hidden = true), ms);
}

function closedTips() {
  try {
    return JSON.parse(localStorage.getItem("walk-closed-tips")) || [];
  } catch (e) {
    return [];
  }
}

function closeStatus() {
  let el = document.getElementById("status");
  el.hidden = true;
  if (!el.dataset.key) return;
  try {
    localStorage.setItem("walk-closed-tips", JSON.stringify([...closedTips(), el.dataset.key]));
  } catch (e) {}
}

function setup() {
  createCanvas(worldWidth(), worldHeight());
  loadFrames();
  loadWorld();
  guy.y = floorY();
  hookButtons();
  hookMap();
  loadSky();
  loadDoorPhoto();
  hookImages();
  hookFill();
  hookMake();
  hookTools();
  hookWorld();
}

function draw() {
  drawWorld();

  if (inkDirty) drawInk();
  image(room().ink, 0, 0, width, height);

  drawDoorHint();
  if (!trip && !mapOpen && !typing()) moveGuy();
  drawImageDraft();
  drawDrafts();
  drawOpening();
  drawShadow();
  drawGuy();
  drawTrip();
  drawEraserCursor();
  drawSelection();
  drawSelectHover();
  syncPortalButton();
  showRoomName();
}

function showRoomName() {
  let el = document.getElementById("roomName");
  if (el.textContent != room().name) el.textContent = room().name;
}

// typing a room's name on the map: the arrow keys belong to the text
function typing() {
  let a = document.activeElement;
  return a && (a.isContentEditable || a.tagName == "INPUT" || a.tagName == "TEXTAREA");
}

// ---- moving ----

function moveGuy() {
  let dir = 0;
  if (keyIsDown(LEFT_ARROW) || held.left) dir -= 1;
  if (keyIsDown(RIGHT_ARROW) || held.right) dir += 1;
  if (dir != 0) guy.facing = dir;

  // up goes through a door if she's at one, and jumps if not
  let up = upTapped || keyIsDown(UP_ARROW) || held.up;
  upTapped = false;
  if (up && guy.onGround) {
    let door = doorNear();
    if (door) return goThrough(door);
    guy.vy = -JUMP;
    guy.onGround = false;
  }

  // walk sideways, but don't climb walls steeper than a step
  if (dir != 0) {
    let nx = guy.x + dir * SPEED;
    if (!wallAt(nx)) {
      guy.x = nx;
      if (guy.onGround) guy.stride += SPEED;
    }
  }

  // stick to the line under him, or fall
  let ground = groundBelow(guy.x, guy.y - STEP_UP);
  if (guy.onGround && ground != null && ground <= guy.y + STEP_UP) {
    guy.y = ground;
    guy.vy = 0;
  } else {
    guy.vy += GRAVITY;
    let ny = guy.y + guy.vy;
    let land = groundBelow(guy.x, guy.y - 1);
    if (guy.vy > 0 && land != null && land <= ny) {
      guy.y = land;
      guy.vy = 0;
      guy.onGround = true;
    } else {
      guy.y = ny;
      guy.onGround = false;
    }
  }

  if (dir == 0 && guy.onGround) guy.stride = 0;

  // lean with the slope so his feet sit flat on it; straighten up in the air
  let target = 0;
  if (guy.onGround) {
    let reach = 12;
    let left = groundBelow(guy.x - reach, guy.y - STEP_UP);
    let right = groundBelow(guy.x + reach, guy.y - STEP_UP);
    if (left != null && right != null && abs(left - guy.y) < STEP_UP * 2 && abs(right - guy.y) < STEP_UP * 2) {
      target = atan2(right - left, reach * 2);
    }
  }
  guy.angle = lerp(guy.angle, target, 0.25);

  // the sides of the window are walls
  guy.x = constrain(guy.x, 20, width - 20);

  // fell out of the world: drop back in from the top
  if (guy.y > height + GUY_HEIGHT) {
    guy.y = -GUY_HEIGHT;
    guy.vy = 0;
    guy.onGround = false;
  }
}

// a line crossing his body at x is too steep to step over
function wallAt(x) {
  let y = groundBelow(x, guy.y - GUY_HEIGHT * 0.8, true);
  return y != null && y < guy.y - STEP_UP;
}

// highest line at x that is at or below fromY
function groundBelow(x, fromY, wallsOnly = false) {
  let best = null;
  for (let l of [...solidLines(), ...lines]) {
    if (wallsOnly && l.platform) continue;
    for (let i = 1; i < l.length; i++) {
      let a = l[i - 1];
      let b = l[i];
      if (x < min(a.x, b.x) || x > max(a.x, b.x)) continue;
      let y = a.x == b.x ? min(a.y, b.y) : lerp(a.y, b.y, (x - a.x) / (b.x - a.x));
      if (y >= fromY && (best == null || y < best)) best = y;
    }
  }
  return best;
}

// ---- drawing him ----

function drawGuy() {
  push();
  translate(guy.x, guy.y);
  rotate(guy.angle);

  if (!walker) {
    if (!framesFailed) {
      pop();
      return;
    }
    scale(guy.facing, 1);
    drawStandIn();
  } else {
    let { imgs, crop } = walker;
    scale(guy.facing * drawnFacing, 1);
    let i = floor(guy.stride / (walker.stepPerFrame * GUY_HEIGHT)) % imgs.length;
    if (guy.stride == 0) i = walker.standing;
    if (!guy.onGround) i = walker.jumping;
    let w = (crop.w * GUY_HEIGHT) / crop.h;
    image(imgs[i], -w / 2, -GUY_HEIGHT, w, GUY_HEIGHT, crop.x, crop.y, crop.w, crop.h);
  }
  pop();
}

// a stick figure to walk around until the real frames are added
function drawStandIn() {
  let t = guy.stride / 10;
  let swing = guy.onGround ? sin(t) * 0.6 : 0.4;
  stroke("#d33");
  strokeWeight(4);
  noFill();
  let hip = -GUY_HEIGHT * 0.45;
  let neck = -GUY_HEIGHT * 0.8;
  let leg = -hip / cos(swing);
  line(0, hip, sin(swing) * leg, 0);
  line(0, hip, sin(-swing) * leg, 0);
  line(0, hip, 0, neck);
  line(0, neck + 10, sin(-swing) * 35, neck + 10 + cos(swing) * 35);
  line(0, neck + 10, sin(swing) * 35, neck + 10 + cos(swing) * 35);
  circle(0, neck - 14, 28);
  line(6, neck - 16, 10, neck - 16);
}

// ---- drawing lines ----

function floorY() {
  return groundOf(room());
}

// the window can change size after the page opens, so the floor is worked out each time
function floorLine() {
  let l = [{ x: -10, y: floorY() }, { x: width + 10, y: floorY() }];
  l.seed = 7;
  l.unseen = floorOf() != "line"; // on a painted floor she walks the ground itself
  return l;
}

// clears the lines and fills here; doors and photos stay, so the rooms stay linked (Undo brings it all back)
function resetLines() {
  pushUndo();
  lines.length = 0;
  room().fills = [];
  inkDirty = true;
  saveWorld();
}

function mousePressed(e) {
  if (e && e.target && e.target != drawingContext.canvas) return; // buttons and the map
  document.getElementById("fillPicker").hidden = true;
  // a photo still waiting for its picture: click it to choose one
  let empty = imageAt(mouseX, mouseY);
  if (empty && !empty.art && tool != "erase" && tool != "select") return choosePhotoFor(empty);
  if (placingDoor) return placeDoor(mouseX, mouseY);
  if (tool == "image") return startImage(mouseX, mouseY);
  if (tool == "erase") return eraseStart(mouseX, mouseY);
  if (tool == "select") return startMove(mouseX, mouseY);
  if (tool == "path") return pathClick(mouseX, mouseY);
  if (tool == "fill") return fillAt(mouseX, mouseY);
  if (tool != "draw") return;
  drawing = [{ x: mouseX, y: mouseY }];
  drawing.seed = random(1000);
  lines.push(drawing);
  room().history.push("line");
}

function mouseDragged() {
  if (scaling) {
    scaleTo(mouseX, mouseY);
    return false;
  }
  if (moving) {
    moveItemTo(mouseX, mouseY);
    return false;
  }
  if (erasing) {
    eraseAt(mouseX, mouseY);
    return false;
  }
  if (imageDraft) {
    imageDraft.x1 = mouseX;
    imageDraft.y1 = mouseY;
    return false;
  }
  if (!drawing) return;
  let last = drawing[drawing.length - 1];
  if (dist(last.x, last.y, mouseX, mouseY) > 4) {
    drawing.push({ x: mouseX, y: mouseY });
    inkDirty = true;
  }
  return false;
}

function mouseReleased() {
  if (scaling) return endScale();
  if (moving) return endMove();
  if (erasing) return eraseEnd();
  if (imageDraft) return finishImage();
  if (drawing && drawing.length < 2) {
    lines.pop();
    room().history.pop();
  }
  if (drawing) saveWorld();
  drawing = null;
  inkDirty = true;
}

function drawInk() {
  let r = room();
  settle(r);
  if (!r.ink || r.ink.width != width || r.ink.height != height) r.ink = createGraphics(width, height);
  let ink = r.ink;
  ink.clear();
  ink.noStroke();
  ink.fill(inkHere());
  for (let f of r.fills) inkFill(ink, f);
  for (let f of r.images) inkImage(ink, f);
  ink.noStroke();
  ink.fill(inkHere());
  for (let l of [...solidLines(), ...roomDrawing()]) if (!l.unseen) inkLine(ink, l);
  for (let l of lines) {
    ink.fill(l.colour || inkHere()); // lines drawn in colour in older worlds keep it
    inkLine(ink, l);
  }
  for (let d of doorsHere()) inkDoor(ink, d);
  inkDirty = false;
}

// A pen line like the ones he's drawn with: smoothed, wobbling a little,
// and a little thicker and thinner along its length.
function inkLine(g, pts, seed = pts.seed) {
  if (!pts.sharp) pts = roundCorners(pts); // drawn shapes like doors and windows keep their corners
  let spots = [];
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    let b = pts[i];
    let len = dist(a.x, a.y, b.x, b.y);
    let nx = -(b.y - a.y) / (len || 1);
    let ny = (b.x - a.x) / (len || 1);
    for (let t = 0; t < len; t += 0.75) {
      let wobble = (noise(seed, d * 0.01) - 0.5) * 3 + (noise(seed + 40, d * 0.08) - 0.5) * 1.2 + (noise(seed + 60, d * 0.5) - 0.5) * 0.4;
      spots.push({ x: lerp(a.x, b.x, t / len) + nx * wobble, y: lerp(a.y, b.y, t / len) + ny * wobble, d });
      d += 0.75;
    }
  }
  for (let s of spots) {
    let w = 2.2 + noise(seed + 80, s.d * 0.02) * 1.3;
    g.circle(s.x, s.y, w);
  }
}

// round off the corners of a line drawn with the mouse
function roundCorners(pts) {
  for (let pass = 0; pass < 2; pass++) {
    if (pts.length < 3) return pts;
    let out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      let a = pts[i];
      let b = pts[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

function keyPressed() {
  if (typing()) return;
  if (keyCode == ENTER && pathDraft) return finishPath();
  if (tool == "select" && (key == "+" || key == "=")) return nudgeScale(1.1);
  if (tool == "select" && (key == "-" || key == "_")) return nudgeScale(1 / 1.1);
  if (keyCode == UP_ARROW) upTapped = true;
  if (keyCode == LEFT_ARROW || keyCode == RIGHT_ARROW || keyCode == UP_ARROW || keyCode == DOWN_ARROW) {
    return false; // don't scroll the page
  }
  if ((key == "z" || key == "Z") && (keyIsDown(CONTROL) || keyIsDown(91))) undo();
  if (key == "m" || key == "M") toggleMap();
}

function undo() {
  let last = room().history.pop();
  selected = null;
  if (last && last.snapshot) restoreSnapshot(last.snapshot);
  if (last == "line") lines.pop();
  if (last == "door") room().doors.pop();
  inkDirty = true;
  saveWorld();
}

function windowResized() {
  let wasOnFloor = guy.onGround && abs(guy.y - floorY()) < 1;
  resizeCanvas(worldWidth(), worldHeight());
  if (wasOnFloor) guy.y = floorY();
  inkDirty = true;
}

function hookButtons() {
  document.getElementById("statusClose").onclick = closeStatus;
  document.getElementById("undo").onclick = undo;
  document.getElementById("clear").onclick = resetLines;
  document.getElementById("mapButton").onclick = toggleMap;
  for (let b of document.querySelectorAll("#doorChoice [data-kind]")) b.onclick = () => linkToNewRoom(b.dataset.kind);
  document.getElementById("pickOnMap").onclick = () => {
    closeDoorChoice();
    openMap(pendingDoor);
  };
  document.getElementById("portalButton").onclick = togglePortal;
  document.getElementById("notYet").onclick = () => {
    pendingDoor = null;
    closeDoorChoice();
  };

  for (let b of document.querySelectorAll("#pad button")) {
    let k = b.dataset.key;
    let down = (e) => { e.preventDefault(); held[k] = true; b.classList.add("on"); };
    let up = (e) => { e.preventDefault(); held[k] = false; b.classList.remove("on"); };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("pointerleave", up);
  }
}
