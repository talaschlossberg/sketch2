// Walk: draw lines, then walk the little guy along them with the arrow keys.
// She starts with walk/frames/walk01.png ... walk22.png (from walk_cycle.mov), facing right.
// Choose folder (or drop a folder on the page) swaps in any other sequence;
// frames.js cleans the frames up and works out how far each one travels.

let BUILT_IN_FRAMES = 22;

let walker = null; // what prepareFrames returns
let drawnFacing = 1; // which way the frames are drawn: -1 left, 1 right
let framesFailed = false;

let lines = []; // every line you draw: a list of {x, y} points, plus a seed for its wobble
let drawing = null;
let FLOOR_GAP = 40; // the floor runs along the bottom of the window, this far up
let ink; // the lines, drawn once into their own layer and redrawn only when they change
let inkDirty = true;

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

// p5's loadImage fetches the file first, which some hosts block,
// so frames are loaded as plain images and copied into p5 images
async function loadBuiltInFrames() {
  let saved = await rememberedFrames();
  if (saved && saved.files.length) {
    drawnFacing = saved.drawnFacing;
    return useFiles(saved.files.map((f) => Object.assign(f.blob, { label: f.name })), false);
  }
  try {
    let els = [];
    for (let n = 1; n <= BUILT_IN_FRAMES; n++) els.push(await urlToImage(frameUrl(n)));
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

async function useFiles(files, remember) {
  files = sortByName(files.filter((f) => isImageFile({ name: f.label || f.name })));
  if (files.length == 0) {
    showStatus("No pictures in there. Pick a folder of PNG or JPG frames.");
    return;
  }
  showStatus("Loading " + files.length + " frames…");
  try {
    let els = [];
    for (let f of files) els.push(await fileToImage(f));
    walker = prepareFrames(els);
    framesFailed = false;
    showStatus(files.length + " frames loaded. If he walks backwards, press Turn around.", 5000);
    if (remember) rememberFrames(files, drawnFacing);
  } catch (e) {
    showStatus("Couldn't open those pictures. Try PNG or JPG files.");
  }
}

function showStatus(text, ms) {
  let el = document.getElementById("status");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(showStatus.timer);
  if (ms) showStatus.timer = setTimeout(() => (el.hidden = true), ms);
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  loadBuiltInFrames();
  resetLines();
  guy.y = floorY();
  hookButtons();
  loadSky();
  hookSkyButtons();
}

function draw() {
  drawSky();

  if (inkDirty) drawInk();
  image(ink, 0, 0, width, height);

  moveGuy();
  drawGuy();
}

// ---- moving ----

function moveGuy() {
  let dir = 0;
  if (keyIsDown(LEFT_ARROW) || held.left) dir -= 1;
  if (keyIsDown(RIGHT_ARROW) || held.right) dir += 1;
  if (dir != 0) guy.facing = dir;

  if ((keyIsDown(UP_ARROW) || held.up) && guy.onGround) {
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
  let y = groundBelow(x, guy.y - GUY_HEIGHT * 0.8);
  return y != null && y < guy.y - STEP_UP;
}

// highest line at x that is at or below fromY
function groundBelow(x, fromY) {
  let best = null;
  for (let l of [floorLine(), ...lines]) {
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
  return height - FLOOR_GAP;
}

// the window can change size after the page opens, so the floor is worked out each time
function floorLine() {
  let l = [{ x: -10, y: floorY() }, { x: width + 10, y: floorY() }];
  l.seed = 7;
  return l;
}

function resetLines() {
  lines = [];
  inkDirty = true;
}

function mousePressed(e) {
  if (e && e.target && e.target.tagName != "CANVAS") return;
  drawing = [{ x: mouseX, y: mouseY }];
  drawing.seed = random(1000);
  lines.push(drawing);
}

function mouseDragged() {
  if (!drawing) return;
  let last = drawing[drawing.length - 1];
  if (dist(last.x, last.y, mouseX, mouseY) > 4) {
    drawing.push({ x: mouseX, y: mouseY });
    inkDirty = true;
  }
  return false;
}

function mouseReleased() {
  if (drawing && drawing.length < 2) lines.pop();
  drawing = null;
  inkDirty = true;
}

function drawInk() {
  if (!ink || ink.width != width || ink.height != height) ink = createGraphics(width, height);
  ink.clear();
  ink.noStroke();
  ink.fill(inkColour());
  for (let l of [floorLine(), ...lines]) inkLine(ink, l);
  inkDirty = false;
}

// A pen line like the ones he's drawn with: smoothed, wobbling a little,
// and a little thicker and thinner along its length.
function inkLine(g, pts, seed = pts.seed) {
  pts = roundCorners(pts);
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
  if (keyCode == LEFT_ARROW || keyCode == RIGHT_ARROW || keyCode == UP_ARROW || keyCode == DOWN_ARROW) {
    return false; // don't scroll the page
  }
  if ((key == "z" || key == "Z") && (keyIsDown(CONTROL) || keyIsDown(91))) undo();
}

function undo() {
  lines.pop();
  inkDirty = true;
}

function windowResized() {
  let wasOnFloor = guy.onGround && abs(guy.y - floorY()) < 1;
  resizeCanvas(windowWidth, windowHeight);
  if (wasOnFloor) guy.y = floorY();
  inkDirty = true;
}

function hookButtons() {
  document.getElementById("undo").onclick = undo;
  document.getElementById("clear").onclick = resetLines;

  let picker = document.getElementById("folder");
  if (!("webkitdirectory" in picker)) picker.removeAttribute("webkitdirectory"); // phones: pick the files instead
  document.getElementById("choose").onclick = () => picker.click();
  picker.onchange = () => {
    useFiles([...picker.files], true);
    picker.value = "";
  };

  document.getElementById("turn").onclick = async () => {
    drawnFacing *= -1;
    let saved = await rememberedFrames();
    if (saved) rememberFrames(saved.files.map((f) => Object.assign(f.blob, { label: f.name })), drawnFacing);
  };

  document.addEventListener("dragover", (e) => {
    e.preventDefault();
    document.body.classList.add("dropping");
  });
  document.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget) document.body.classList.remove("dropping");
  });
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    document.body.classList.remove("dropping");
    useFiles(await droppedFiles(e.dataTransfer), true);
  });
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
