// Sky: the painted skies the walls use (blue, clouds, sunset, night, with film
// grain), and your own photo for a place's wall (a film sunset until you choose one).
// Used by sketch.js.

let skyName = "day"; // the last sky picked: what a room's window looks out on
let skyPhoto = null; // the film sunset, shown until you choose a photo of your own
let ownPhotos = {}; // your photos, loaded: picture data -> p5 image
let ownPhotoSrc = null; // the photo of your own the sky shows now, if any
let skyLayer = null; // the sky drawn at the window's size, redrawn only on resize or change
let grain = null;
let cloudDrift = 0;

function skyPhotoUrl() {
  return "sky/sunset.jpg";
}

function loadSky() {
  urlToImage(skyPhotoUrl()).then((el) => {
    skyPhoto = createImage(el.naturalWidth, el.naturalHeight);
    skyPhoto.drawingContext.drawImage(el, 0, 0);
    skyLayer = null;
    worldKey = "";
  }, () => {});
}

function setSkyName(name) {
  if (name == skyName) return;
  skyName = name;
  skyLayer = null;
}

// the sky shows this place's own photo, or the film sunset if it has none
function useOwnPhoto(src) {
  ownPhotoSrc = src || null;
  skyLayer = null;
  if (src && !ownPhotos[src]) {
    urlToImage(src).then((el) => {
      let img = createImage(el.naturalWidth, el.naturalHeight);
      img.drawingContext.drawImage(el, 0, 0);
      ownPhotos[src] = img;
      skyLayer = null;
      worldKey = "";
    }, () => {});
  }
}

function photoForSky() {
  return (ownPhotoSrc && ownPhotos[ownPhotoSrc]) || skyPhoto;
}

// a photo of your own for this place's wall, kept with the world
function setOwnPhoto(file) {
  fileToImage(file).then((el) => {
    let c = document.createElement("canvas");
    let k = min(1, 1800 / max(el.naturalWidth, el.naturalHeight));
    c.width = round(el.naturalWidth * k);
    c.height = round(el.naturalHeight * k);
    c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);
    let src = c.toDataURL("image/jpeg", 0.86);
    room().skyPhoto = src;
    useOwnPhoto(src);
    chooseWall("photo");
  }, () => showStatus("Couldn't open that picture. Try a JPG or PNG.", 4000));
}

// the last sky picked, full size: a room's window shows it, shrunk to fit
function drawSky() {
  if (!skyLayer || skyLayer.width != width || skyLayer.height != height) {
    skyLayer = createGraphics(width, height);
    paintSkyInto(skyLayer, skyName);
  }
  image(skyLayer, 0, 0, width, height);
  if (skyName == "day" || skyName == "sunset") {
    let clouds = cloudsFor(skyName);
    image(clouds, -cloudDrift, 0, clouds.width, height);
  }
}

let cloudLayers = {};

// drifting clouds for a sky, made once per size
function cloudsFor(name) {
  let c = cloudLayers[name];
  if (!c || c.height != height) c = cloudLayers[name] = makeClouds(width, height, name == "sunset" ? sunsetCloud : dayCloud);
  return c;
}

function paintSkyInto(g, name) {
  if (name == "photo") {
    g.background(120, 140, 170);
    if (photoForSky()) coverImage(g, photoForSky());
  } else if (name == "sunset") gradient(g, color(46, 58, 108), color(250, 176, 136), color(168, 128, 166));
  else if (name == "day") gradient(g, color(92, 138, 196), color(214, 228, 238));
  else if (name == "blue") gradient(g, color(70, 128, 176), color(168, 206, 214));
  else {
    gradient(g, color(9, 14, 38), color(46, 58, 104));
    stars(g);
  }
}

// fill the window with the photo, cropping whatever doesn't fit
function coverImage(g, img) {
  let s = max(g.width / img.width, g.height / img.height);
  let w = img.width * s;
  let h = img.height * s;
  g.image(img, (g.width - w) / 2, (g.height - h) / 2, w, h);
}

// top to bottom, optionally through a middle colour just over halfway down
function gradient(g, top, bottom, middle) {
  for (let y = 0; y < g.height; y++) {
    let t = pow(y / g.height, 1.3);
    let c = lerpColor(top, bottom, t);
    if (middle) c = t < 0.55 ? lerpColor(top, middle, t / 0.55) : lerpColor(middle, bottom, (t - 0.55) / 0.45);
    g.noStroke();
    g.fill(c);
    g.rect(0, y, g.width, 1.5);
  }
}

// cloud colour for a given thickness (0 to 1) and height up the sky (0 top, 1 bottom)
function dayCloud(c, y) {
  let shade = 255 - (1 - y) * 18 - c * 22; // a little grey in the thick parts
  return [shade, shade, shade + 6];
}

// lit pink and orange from below, violet grey where they're thick
function sunsetCloud(c, y) {
  let lit = constrain(1.25 - c * 0.8 + y * 0.4, 0, 1);
  return [lerp(92, 255, lit), lerp(90, 128, lit), lerp(138, 124, lit)];
}

// Soft heaps of cloud. Painted small and scaled up so they stay soft and quick to draw;
// the pattern wraps round sideways so the layer can drift forever.
function makeClouds(w, h, tint) {
  let scaleDown = 4;
  let cw = ceil((w * 1.5) / scaleDown);
  let ch = ceil(h / scaleDown);
  let small = createImage(cw, ch);
  small.loadPixels();
  let r = cw / TWO_PI / 60;
  for (let y = 0; y < ch; y++) {
    let fade = constrain(map(y, ch * 0.05, ch * 0.75, 1, 0.15), 0, 1);
    for (let x = 0; x < cw; x++) {
      let a = (x / cw) * TWO_PI;
      let nx = cos(a) * r;
      let nz = sin(a) * r;
      let v = 0;
      let amp = 0.5;
      let f = 1;
      for (let o = 0; o < 5; o++) {
        v += amp * noise(nx * f + 11, (y / 45) * f, nz * f + 23);
        amp *= 0.5;
        f *= 2;
      }
      let c = constrain((v - 0.46) * 5, 0, 1) * fade;
      let i = (y * cw + x) * 4;
      let [red, green, blue] = tint(c, y / ch);
      small.pixels[i] = red;
      small.pixels[i + 1] = green;
      small.pixels[i + 2] = blue;
      small.pixels[i + 3] = c * 235;
    }
  }
  small.updatePixels();
  let layer = createGraphics(cw * scaleDown, h);
  layer.drawingContext.imageSmoothingQuality = "high";
  layer.image(small, 0, 0, layer.width, layer.height);
  return layer;
}

function stars(g) {
  randomSeed(4);
  g.noStroke();
  let count = (g.width * g.height) / 2500;
  for (let i = 0; i < count; i++) {
    let y = pow(random(), 1.6) * g.height * 0.85; // thicker towards the top
    let s = random() < 0.08 ? random(1.6, 2.4) : random(0.6, 1.3);
    g.fill(255, 250, 235, random(120, 255));
    g.circle(random(g.width), y, s);
  }
  randomSeed(millis());
}

function makeGrain(w, h) {
  let tile = createImage(256, 256);
  tile.loadPixels();
  for (let i = 0; i < tile.pixels.length; i += 4) {
    let v = random(255);
    tile.pixels[i] = v;
    tile.pixels[i + 1] = v;
    tile.pixels[i + 2] = v;
    tile.pixels[i + 3] = 22;
  }
  tile.updatePixels();
  let g = createGraphics(w, h);
  for (let y = 0; y < h; y += 256) for (let x = 0; x < w; x += 256) g.image(tile, x, y);
  return g;
}

