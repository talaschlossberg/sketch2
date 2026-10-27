// Opening: plays by itself. A pen line on white. She walks on from the right and off the left;
// the next one stops just short of the edge, and the rest come in and line up behind her.
// When the line nearly fills the screen the view pans, over a bump in the ground, until the
// screen is half full again. Then one last person walks on to the end of the line, and a beat
// later the title comes on. R plays it again.
// Uses prepareFrames and feetSpread from ../walk/frames.js, and dress and lookFor from dress.js.

let FRAME_COUNT = 22;
let TITLE_FPS = 8; // as the video was made

let walkFrames = null; // what prepareFrames returns
let stopFrames = []; // frames where her feet are together, as if standing
// the boiling title from the video, and the hand-lettered one (Y switches), wiggled by title2/make_wiggle.py
let TITLES = [
  { path: "title/title", count: 49, frames: [] },
  { path: "title2/title", count: 8, frames: [] },
];
let titleIndex = 0;
let showTitle = false;
let titleDue = null; // when the title comes on, a beat after the last one stops
let titleFadeFrom = -Infinity;
let hintTimer = null;

// the timing, in her heights and seconds
let WALK_SPEED = 0.85; // how fast they walk
let SEND_EVERY = 1.1; // seconds between people joining the line
let SPACING = 0.55; // how far apart they stand, give or take
let PAN_SPEED = 0.9; // a slow, steady pan
let PAN_FROM = 0.82; // the pan starts when the line reaches this far across the screen
let PAN_BY = 0.9; // and moves this many screen widths
let PAN_UNTIL = 0.5; // people keep joining until the line reaches halfway across the final view
let TITLE_BEAT = 1000; // ms after the last one stops
let TITLE_FADE = 450; // ms

let people = []; // everyone on screen, oldest first
let sent = 0; // how many have walked on
let camX = 0; // how far the view has panned right
let camSpeed = 0;
let stage = "waiting";
// waiting -> first (she walks across and off) -> lining (people join; the pan starts and stops
// on its own) -> settling (no one new until the pan and everyone have stopped) -> last -> done
let tail = null; // where the last one sent will stand, in ground coordinates
let nextSend = 0; // ms
let panning = false;
let panEnd = 0; // where the view comes to rest
let bump = null; // { at, wide, tall }, in the left half of where the view comes to rest
let spacingRandom = null;

// pictures come from files, or from the page itself in the single-file version
function pictureUrl(path) {
  return (window.INLINE && window.INLINE[path]) || path;
}

function urlToImage(url) {
  return new Promise((done, fail) => {
    let el = new Image();
    el.onload = () => done(el);
    el.onerror = fail;
    el.src = url;
  });
}

function numbered(prefix, n) {
  return pictureUrl(prefix + String(n).padStart(2, "0") + ".png");
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  noiseSeed(7); // the same pen line every time

  let walkEls = [];
  for (let n = 1; n <= FRAME_COUNT; n++) walkEls.push(urlToImage(numbered("../walk/frames/walk", n)));
  Promise.all(walkEls).then((els) => {
    walkFrames = prepareFrames(els);
    let spreads = walkFrames.imgs.map((img) => feetSpread(img, walkFrames.crop));
    let lo = min(spreads);
    let hi = max(spreads);
    spreads.forEach((s, i) => {
      if (s <= lo + (hi - lo) * 0.08) stopFrames.push(i);
    });
    setTimeout(() => {
      if (stage == "waiting") playFromStart();
    }, 800);
  });

  for (let t of TITLES) {
    for (let n = 1; n <= t.count; n++) urlToImage(numbered(t.path, n)).then((el) => (t.frames[n - 1] = el));
  }

  showHint();
}

function draw() {
  background(255);
  let h = personHeight();
  let dt = min(deltaTime, 50) / 1000;

  if (walkFrames && stage != "waiting") direct(h);
  for (let p of people) movePerson(p, h, dt);
  people = people.filter((p) => p.x - camX > -h); // walked off the left
  panView(h, dt);

  if (titleDue != null && millis() >= titleDue) {
    titleDue = null;
    showTitle = true;
    titleFadeFrom = millis();
  }
  if (showTitle) drawTitle();

  push();
  translate(-camX, 0);
  drawGround();
  for (let p of people) drawPerson(p, h);
  pop();
}

// ---- the sequence ----

function playFromStart() {
  people = [];
  sent = 0;
  camX = 0;
  camSpeed = 0;
  panning = false;
  tail = null;
  showTitle = false;
  titleDue = null;
  spacingRandom = seededRandom(11);
  panEnd = width * PAN_BY;
  bump = { at: panEnd + width * 0.33, wide: width * 0.28, tall: height * 0.12 }; // off the first screen, so it opens on a flat line
  sendPerson(null); // the first one walks straight across and off
  stage = "first";
}

function direct(h) {
  let now = millis();
  let line = people.filter((p) => p.spot != null);

  if (stage == "first") {
    // once she's halfway across, the next one follows and stops just short of the left edge
    let first = people[0];
    if (!first || first.x - camX < width * 0.5) {
      tail = camX + h * 0.24;
      sendPerson(tail);
      nextSend = now + SEND_EVERY * 1000;
      stage = "lining";
    }
  } else if (stage == "lining") {
    if (now >= nextSend) {
      let spot = tail + h * SPACING * (0.85 + 0.3 * spacingRandom());
      if (spot > panEnd + width * PAN_UNTIL) stage = "settling"; // the final view is half full
      else {
        tail = spot;
        sendPerson(tail);
        nextSend += SEND_EVERY * 1000;
      }
    }
  }
  // the pan: it starts once the line nearly fills the screen, and lets go just early enough to glide to rest at panEnd
  if (camX == 0 && !panning) {
    let standingEnd = max(line.filter((p) => p.stopped).map((p) => p.x));
    if (standingEnd - camX > width * PAN_FROM) panning = true;
  }
  if (panning && camX >= panEnd - camSpeed / 1.6) panning = false;

  if (stage == "settling") {
    if (camX > 0 && !panning && abs(camSpeed) < 2 && line.every((p) => p.stopped)) {
      tail += h * SPACING;
      sendPerson(tail).last = true;
      stage = "last";
    }
  } else if (stage == "last") {
    let last = people[people.length - 1];
    if (last.stopped) {
      titleDue = now + TITLE_BEAT;
      stage = "done";
    }
  }
}

// someone new walks on from the right; with a spot, she stops there
function sendPerson(spot) {
  let h = personHeight();
  let x = camX + width + h * 0.4;
  let cycle = FRAME_COUNT * walkFrames.stepPerFrame * h;
  let stride = random(cycle);
  if (spot != null) {
    // start her stride so that she arrives at her spot with her feet together
    let k = random(stopFrames);
    let arrive = (k + 0.5) * walkFrames.stepPerFrame * h;
    stride = (((arrive - (x - spot)) % cycle) + cycle) % cycle;
  }
  let p = { x, spot, stride, frame: 0, stopped: false, imgs: dress(walkFrames, lookFor(sent)) };
  sent++;
  people.push(p);
  return p;
}

function movePerson(p, h, dt) {
  if (p.stopped) return;
  let step = h * WALK_SPEED * dt;
  if (p.spot != null && p.x - step <= p.spot) {
    step = p.x - p.spot;
    p.stopped = true;
  }
  p.x -= step;
  p.stride += step;
  // the frames follow the distance covered, so her feet don't slide
  p.frame = floor(p.stride / (walkFrames.stepPerFrame * h)) % FRAME_COUNT;
}

// the view eases into a steady pan and eases out of it again
function panView(h, dt) {
  let goal = panning ? PAN_SPEED * h : 0;
  camSpeed += (goal - camSpeed) * (1 - exp(-dt * (panning ? 0.9 : 1.6)));
  camX += camSpeed * dt;
}

// ---- sizes ----

function personHeight() {
  return min(height * 0.42, width * 0.32);
}

function groundY() {
  return height * 0.88;
}

// ---- the ground ----

// flat, except for one rounded bump just past the first screen, where the view pans to
function groundAt(x) {
  if (!bump) return groundY();
  let d = (x - bump.at) / bump.wide;
  if (abs(d) >= 1) return groundY();
  return groundY() - bump.tall * (0.5 + 0.5 * cos(d * PI));
}

function slopeAt(x) {
  return (groundAt(x + 8) - groundAt(x - 8)) / 16;
}

// a pen line along the ground, like the lines drawn in Walk: a slight wobble and a nib that thickens and thins
function drawGround() {
  let g = drawingContext;
  g.strokeStyle = "#1a1916";
  g.lineCap = "round";
  let step = 2;
  let x0 = floor((camX - 20) / step) * step; // steps fixed to the ground, so the line doesn't shimmer as it pans
  let prev = null;
  for (let x = x0; x < camX + width + 20; x += step) {
    let wobble = (noise(900, x * 0.01) - 0.5) * 3 + (noise(940, x * 0.08) - 0.5) * 1.2;
    let pt = { x, y: groundAt(x) + wobble };
    if (prev) {
      g.lineWidth = 2.2 + noise(980, x * 0.02) * 1.3;
      g.beginPath();
      g.moveTo(prev.x, prev.y);
      g.lineTo(pt.x, pt.y);
      g.stroke();
    }
    prev = pt;
  }
}

// ---- the title ----

function drawTitle() {
  let t = TITLES[titleIndex];
  let el = t.frames[floor((millis() / 1000) * TITLE_FPS) % t.count];
  if (!el) return;
  let w = min(width * 0.72, ((groundY() - personHeight()) * 0.55 * el.width) / el.height);
  let h = (w * el.height) / el.width;
  let top = max(height * 0.07, (groundY() - personHeight() - h) * 0.4);
  drawingContext.globalAlpha = constrain((millis() - titleFadeFrom) / TITLE_FADE, 0, 1);
  drawingContext.drawImage(el, (width - w) / 2, top, w, h);
  drawingContext.globalAlpha = 1;
}

// ---- people ----

function drawPerson(p, h) {
  let { crop } = walkFrames;
  let w = (crop.w * h) / crop.h;
  push();
  translate(p.x, groundAt(p.x) + 1);
  rotate(atan(slopeAt(p.x)) * 0.6); // leans into the slope, as she does in Walk, but less
  scale(-1, 1); // her frames face right; she walks left
  drawingContext.drawImage(p.imgs[p.frame], crop.x, crop.y, crop.w, crop.h, -w / 2, -h, w, h);
  pop();
}

// ---- keys ----

function keyPressed() {
  hideHint();
  if (key == "r" || key == "R" || key == " ") {
    if (walkFrames) playFromStart();
  } else if (key == "t" || key == "T") {
    showTitle = !showTitle;
    titleFadeFrom = -Infinity;
  } else if (key == "y" || key == "Y") titleIndex = (titleIndex + 1) % TITLES.length;
  else if (key == "f" || key == "F") fullscreen(!fullscreen());
  else if (key == "h" || key == "H" || key == "?") showHint(true);
  else return;
  return false;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function showHint(stay) {
  let el = document.getElementById("hint");
  el.hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(hideHint, stay ? 6000 : 4000);
}

function hideHint() {
  document.getElementById("hint").hidden = true;
}
