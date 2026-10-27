// Opening: a white screen, the title boiling at the top, and her walking on from the right.
// Press 1 and she stops where she is and someone new walks on, dressed a little differently.
// Uses prepareFrames and feetSpread from ../walk/frames.js.

let FRAME_COUNT = 22;
let TITLE_COUNT = 49;
let TITLE_FPS = 8; // as the video was made

let walkFrames = null; // what prepareFrames returns
let stopFrames = []; // frames where her feet are close enough together to stand on
let titleFrames = [];
let showTitle = true;
let people = []; // everyone on screen, oldest first
let personCount = 0; // how many have walked on since the start
let hintTimer = null;

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

  let walkEls = [];
  for (let n = 1; n <= FRAME_COUNT; n++) walkEls.push(urlToImage(numbered("../walk/frames/walk", n)));
  Promise.all(walkEls).then((els) => {
    walkFrames = prepareFrames(els);
    let spreads = walkFrames.imgs.map((img) => feetSpread(img, walkFrames.crop));
    let lo = min(spreads);
    let hi = max(spreads);
    spreads.forEach((s, i) => {
      if (s <= lo + (hi - lo) * 0.17) stopFrames.push(i); // feet together, as if standing
    });
    setTimeout(() => {
      if (!people.length) newPerson();
    }, 600);
  });

  for (let n = 1; n <= TITLE_COUNT; n++) {
    urlToImage(numbered("title/title", n)).then((el) => (titleFrames[n - 1] = el));
  }

  showHint();
}

function draw() {
  background(255);
  if (showTitle) drawTitle();

  let h = personHeight();
  let ground = groundY();
  for (let p of people) movePerson(p, h);
  people = people.filter((p) => p.x > -h); // walked off the left
  for (let p of people) drawPerson(p, h, ground);
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
  let el = titleFrames[floor((millis() / 1000) * TITLE_FPS) % TITLE_COUNT];
  if (!el) return;
  let w = min(width * 0.72, ((groundY() - personHeight()) * 0.55 * el.width) / el.height);
  let h = (w * el.height) / el.width;
  let top = max(height * 0.07, (groundY() - personHeight() - h) * 0.4);
  drawingContext.drawImage(el, (width - w) / 2, top, w, h);
}

// ---- people ----

function newPerson() {
  if (!walkFrames) return;
  let walking = people.find((p) => !p.stopping && !p.stopped);
  if (walking) walking.stopping = true;

  let look = lookFor(personCount);
  people.push({
    x: width + personHeight() * 0.4,
    stride: random(FRAME_COUNT) * walkFrames.stepPerFrame * personHeight(), // each starts at a different point in the stride, so they can stop anywhere
    frame: 0,
    stopping: false,
    stopped: false,
    imgs: dress(walkFrames, look),
  });
  personCount++;
}

function movePerson(p, h) {
  if (p.stopped) return;
  let onScreen = p.x < width - h * 0.3; // pressing 1 twice quickly mustn't leave someone stuck off the edge
  if (p.stopping && onScreen && stopFrames.includes(p.frame)) {
    p.stopped = true;
    return;
  }
  let step = h * 0.56 * min(deltaTime, 50) / 1000; // as fast as she walks in Walk
  p.x -= step;
  p.stride += step;
  // the frames follow the distance covered, so her feet don't slide
  p.frame = floor(p.stride / (walkFrames.stepPerFrame * h)) % FRAME_COUNT;
}

function drawPerson(p, h, ground) {
  let { crop } = walkFrames;
  let w = (crop.w * h) / crop.h;
  push();
  translate(p.x, ground);
  scale(-1, 1); // her frames face right; she walks left
  drawingContext.drawImage(p.imgs[p.frame], crop.x, crop.y, crop.w, crop.h, -w / 2, -h, w, h);
  pop();
}

function undoPerson() {
  people.pop();
  let last = people[people.length - 1];
  if (last && last.stopped && last.x < width) {
    // whoever was standing last carries on, as if 1 hadn't been pressed
    last.stopped = false;
    last.stopping = false;
  }
  personCount = max(0, personCount - 1);
}

function startOver() {
  people = [];
  personCount = 0;
  newPerson();
}

// ---- keys ----

function keyPressed() {
  hideHint();
  if (key == "1") newPerson();
  else if (keyCode == BACKSPACE || key == "z" || key == "Z") undoPerson();
  else if (key == "r" || key == "R") startOver();
  else if (key == "t" || key == "T") showTitle = !showTitle;
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
