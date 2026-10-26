// Walk: draw lines, then walk the little guy along them with the arrow keys.
// Frames are walk/frames/00010walk.png ... 00023walk.png, drawn facing right.

let FIRST_FRAME = 10;
let LAST_FRAME = 23;

let frames = [];
let missing = 0;
let crop; // shared box around the drawing in every frame, so his feet stay put

let lines = []; // every line is a list of {x, y} points
let drawing = null;

let guy = {
  x: 120,
  y: 0, // y of his feet
  vy: 0,
  facing: 1,
  onGround: false,
  stride: 0, // distance walked, drives the frame
};

let GUY_HEIGHT = 140;
let SPEED = 3;
let GRAVITY = 0.6;
let JUMP = 11;
let STEP_UP = 18; // tallest bump he can step onto without jumping
let PIXELS_PER_FRAME = 7;

let held = { left: false, right: false, up: false };

function preload() {
  for (let n = FIRST_FRAME; n <= LAST_FRAME; n++) {
    let name = "frames/" + nf(n, 5) + "walk.png";
    frames.push(loadImage(name, () => {}, () => missing++));
  }
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  if (missing > 0) {
    frames = [];
  } else {
    crop = findCrop(frames);
  }
  resetLines();
  guy.y = height - 60;
  hookButtons();
}

function draw() {
  background("#f4efe4");

  stroke("#222");
  strokeWeight(4);
  strokeJoin(ROUND);
  strokeCap(ROUND);
  noFill();
  for (let l of lines) {
    beginShape();
    for (let p of l) vertex(p.x, p.y);
    endShape();
  }

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

  // walked off the edge of the world: drop back in from the top
  if (guy.y > height + GUY_HEIGHT || guy.x < -50 || guy.x > width + 50) {
    guy.x = constrain(guy.x, 40, width - 40);
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
  for (let l of lines) {
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
  scale(guy.facing, 1);

  if (frames.length == 0) {
    drawStandIn();
  } else {
    let i = guy.onGround ? floor(guy.stride / PIXELS_PER_FRAME) % frames.length : 2;
    if (guy.stride == 0 && guy.onGround) i = 0;
    let s = GUY_HEIGHT / crop.h;
    let w = crop.w * s;
    image(frames[i], -w / 2, -GUY_HEIGHT, w, GUY_HEIGHT, crop.x, crop.y, crop.w, crop.h);
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

// smallest box that holds the non-transparent pixels of every frame
function findCrop(imgs) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let img of imgs) {
    img.loadPixels();
    let w = img.width;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < w; x++) {
        if (img.pixels[(y * w + x) * 4 + 3] > 20) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: imgs[0].width, h: imgs[0].height };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ---- drawing lines ----

function resetLines() {
  lines = [[{ x: 0, y: height - 40 }, { x: width, y: height - 40 }]];
}

function mousePressed(e) {
  if (e && e.target && e.target.tagName != "CANVAS") return;
  drawing = [{ x: mouseX, y: mouseY }];
  lines.push(drawing);
}

function mouseDragged() {
  if (!drawing) return;
  let last = drawing[drawing.length - 1];
  if (dist(last.x, last.y, mouseX, mouseY) > 4) drawing.push({ x: mouseX, y: mouseY });
  return false;
}

function mouseReleased() {
  if (drawing && drawing.length < 2) lines.pop();
  drawing = null;
}

function keyPressed() {
  if (keyCode == LEFT_ARROW || keyCode == RIGHT_ARROW || keyCode == UP_ARROW || keyCode == DOWN_ARROW) {
    return false; // don't scroll the page
  }
  if ((key == "z" || key == "Z") && (keyIsDown(CONTROL) || keyIsDown(91))) undo();
}

function undo() {
  if (lines.length > 1) lines.pop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function hookButtons() {
  document.getElementById("undo").onclick = undo;
  document.getElementById("clear").onclick = resetLines;
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
