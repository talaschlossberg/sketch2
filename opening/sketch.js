// Opening: a pen line on white, and her walking on from the right.
// Press 1 and she stops where she is and someone new walks on, dressed a little differently.
// Press 2 and the pan stops and one last person walks on to the end of the line. T cues the title.
// Uses prepareFrames from ../walk/frames.js, and dress and lookFor from dress.js.

let FRAME_COUNT = 22;
let TITLE_FPS = 8; // as the video was made

let walkFrames = null; // what prepareFrames returns
// the boiling title from the video, and the hand-lettered one (Y switches), wiggled by title2/make_wiggle.py
let TITLES = [
  { path: "title/title", count: 49, frames: [] },
  { path: "title2/title", count: 8, frames: [] },
];
let titleIndex = 0;
let showTitle = false; // no title until T cues it
let titleFadeFrom = -Infinity;
let TITLE_FADE = 450; // ms
let people = []; // everyone on screen, oldest first
let personCount = 0; // how many have walked on since the start
let hintTimer = null;
let camX = 0; // how far the view has panned right, following the line
let camSpeed = 0;
let panning = false; // a slow, steady pan, from when the line nears the far side until 2
let finishing = false; // 2 was pressed
let ROOM_AHEAD = 0.4; // once the line reaches this share of the screen from the right, the pan begins
let WALK_SPEED = 0.85; // her heights per second, each a little faster or slower, so their steps never fall in time
let PAN_SPEED = 0.33; // the slowest the pan goes, in her heights per second
let PAN_TOP = 2.5; // the fastest
let LINE_GAP = 0.42; // the closest the last walker stops behind the one before, in her heights

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
  noiseSeed(7); // the same hills and the same pen line every time

  let walkEls = [];
  for (let n = 1; n <= FRAME_COUNT; n++) walkEls.push(urlToImage(numbered("../walk/frames/walk", n)));
  Promise.all(walkEls).then((els) => {
    walkFrames = prepareFrames(els);
    setTimeout(() => {
      if (!people.length) newPerson();
    }, 600);
  });

  for (let t of TITLES) {
    for (let n = 1; n <= t.count; n++) urlToImage(numbered(t.path, n)).then((el) => (t.frames[n - 1] = el));
  }

  showHint();
}

function draw() {
  background(255);
  if (showTitle) drawTitle();

  let h = personHeight();
  for (let p of people) movePerson(p, h);
  people = people.filter((p) => p.x - camX > -h); // walked off the left
  panView(h);
  push();
  translate(-camX, 0);
  drawGround();
  for (let p of people) drawPerson(p, h);
  pop();
}

// ---- the ground ----

// straight, except for one jagged bump just past the first screen, where the view pans to
function groundAt(x) {
  let d = (x - width * 1.45) / (width * 0.38);
  if (abs(d) >= 1) return groundY();
  let rise = 0.5 + 0.5 * cos(d * PI); // eases up from the straight and back down to it, with no kink
  let lumps = 0.7 + 0.6 * noise(x / 170); // uneven, not a smooth hump
  let jags = (noise(500 + x / 90) - 0.5) * 0.06; // just a little crooked, hand-drawn
  return groundY() - rise * (lumps + jags) * height * 0.15;
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

// once the line nears the far side, the view starts a steady pan; 2 brings it gently to a stop.
// The quicker you press 1, the further right the line ends up, and the pan speeds up to match,
// so people stand spread out at whatever pace you send them on. It changes speed gradually, never in jerks.
function panView(h) {
  let mark = width * (1 - ROOM_AHEAD) - h * 0.2; // where the end of the line should sit on screen
  let ahead = lineEnd() - camX - mark;
  if (!panning && !finishing && ahead > 0) panning = true;
  let goal = 0;
  if (panning && !finishing) goal = constrain(PAN_SPEED * h + ahead * 0.75, PAN_SPEED * h, PAN_TOP * h);
  let dt = min(deltaTime, 50) / 1000;
  camSpeed += (goal - camSpeed) * (1 - exp(-dt * (finishing ? 2 : 0.7))); // eases over a couple of seconds; to a stop in about one
  camX += camSpeed * dt;
}

// how far apart the last few in line stand, so the last walker keeps the same rhythm
function lineSpacing(except, h) {
  let xs = people.filter((p) => p != except && p.stopped).map((p) => p.x).sort((a, b) => a - b).slice(-4);
  let gaps = xs.slice(1).map((x, i) => x - xs[i]);
  let typical = gaps.length ? gaps.reduce((a, b) => a + b) / gaps.length : 0;
  return constrain(typical, h * LINE_GAP, h);
}

// where the last one standing (or coming to a stop) is
function lineEnd(except) {
  let line = people.filter((p) => p != except && (p.stopped || p.stopping));
  return line.length ? max(line.map((p) => p.x)) : -Infinity;
}

// ---- sizes ----

function personHeight() {
  return min(height * 0.42, width * 0.32);
}

function groundY() {
  return height * 0.88;
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

function newPerson() {
  if (!walkFrames) return;
  let walking = people.find((p) => !p.stopping && !p.stopped);
  if (walking) {
    walking.stopping = true;
    walking.last = false;
  }
  finishing = false;

  let look = lookFor(personCount);
  people.push({
    x: camX + width + personHeight() * 0.4,
    stride: random(FRAME_COUNT) * walkFrames.stepPerFrame * personHeight(), // each starts at a different point in the stride
    speed: WALK_SPEED * random(0.9, 1.1),
    frame: 0,
    stopping: false,
    stopped: false,
    imgs: dress(walkFrames, look),
  });
  personCount++;
}

function movePerson(p, h) {
  if (p.stopped) return;
  // the last walker stops on her own, a step behind the one before
  if (p.last && !p.stopping) {
    let end = lineEnd(p);
    let spot = end > -Infinity ? end + lineSpacing(p, h) : camX + width * 0.35; // on her own, she stops left of middle
    if (p.x <= spot) p.stopping = true;
  }
  let onScreen = p.x - camX < width - h * 0.3; // pressing 1 twice quickly mustn't leave someone stuck off the edge
  if (p.stopping && onScreen) {
    // she freezes mid-step, on whatever frame she's on, so each one stands a little differently
    p.stopped = true;
    return;
  }
  let step = h * p.speed * min(deltaTime, 50) / 1000;
  p.x -= step;
  p.stride += step;
  // the frames follow the distance covered, so her feet don't slide
  p.frame = floor(p.stride / (walkFrames.stepPerFrame * h)) % FRAME_COUNT;
}

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

// 2: whoever is walking stops, the pan comes to rest, and one last person walks on to join the end of the line
function lastPerson() {
  if (finishing) return;
  newPerson();
  let last = people[people.length - 1];
  if (last) last.last = true;
  finishing = true;
}

function undoPerson() {
  let gone = people.pop();
  if (gone && gone.last) {
    finishing = false; // taking back the last one takes back the ending too
  }
  let last = people[people.length - 1];
  if (last && last.stopped && last.x - camX < width) {
    // whoever was standing last carries on, as if 1 hadn't been pressed
    last.stopped = false;
    last.stopping = false;
  }
  personCount = max(0, personCount - 1);
}

function startOver() {
  people = [];
  personCount = 0;
  camX = 0;
  camSpeed = 0;
  panning = false;
  finishing = false;
  showTitle = false;
  newPerson();
}

// T fades the title on; pressed again, it goes
function cueTitle() {
  showTitle = !showTitle;
  if (showTitle) titleFadeFrom = millis();
}

// ---- keys ----

function keyPressed() {
  hideHint();
  if (key == "1") newPerson();
  else if (key == "2") lastPerson();
  else if (keyCode == BACKSPACE || key == "z" || key == "Z") undoPerson();
  else if (key == "r" || key == "R") startOver();
  else if (key == "t" || key == "T") cueTitle();
  else if (key == "y" || key == "Y") titleIndex = (titleIndex + 1) % TITLES.length; // which title T will bring on
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
