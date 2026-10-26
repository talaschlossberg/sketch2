// Sky: three backdrops to pick from. Sunset is a photo; day and night are
// painted here, with film grain so they sit alongside the photo.
// Used by sketch.js.

let SKIES = {
  sunset: { label: "Sunset", ink: 17 },
  day: { label: "Day", ink: 17 },
  night: { label: "Night", ink: 240 },
};

let skyName = "sunset";
let skyPhoto = null; // the sunset photo, once it has loaded
let skyLayer = null; // the sky drawn at the window's size, redrawn only on resize or change
let cloudLayer = null; // day clouds, drawn wide enough to drift and wrap
let grain = null;
let cloudDrift = 0;

function skyPhotoUrl() {
  return "sky/sunset.jpg";
}

function loadSky() {
  try {
    let saved = localStorage.getItem("walk-sky");
    if (SKIES[saved]) skyName = saved;
  } catch (e) {}
  urlToImage(skyPhotoUrl()).then((el) => {
    skyPhoto = createImage(el.naturalWidth, el.naturalHeight);
    skyPhoto.drawingContext.drawImage(el, 0, 0);
    skyLayer = null;
  }, () => {});
  markSkyButtons();
}

function chooseSky(name) {
  skyName = name;
  skyLayer = null;
  inkDirty = true; // the lines change colour with the sky
  markSkyButtons();
  try {
    localStorage.setItem("walk-sky", name);
  } catch (e) {}
}

function markSkyButtons() {
  for (let b of document.querySelectorAll("#skies button")) {
    b.classList.toggle("on", b.dataset.sky == skyName);
  }
  document.body.dataset.sky = skyName;
}

function inkColour() {
  return SKIES[skyName].ink;
}

function drawSky() {
  if (!skyLayer || skyLayer.width != width || skyLayer.height != height) paintSky();
  image(skyLayer, 0, 0, width, height);

  if (skyName == "day" && cloudLayer) {
    cloudDrift = (cloudDrift + 0.15) % cloudLayer.width;
    image(cloudLayer, -cloudDrift, 0, cloudLayer.width, height);
    image(cloudLayer, cloudLayer.width - cloudDrift, 0, cloudLayer.width, height);
  }
  if (skyName != "sunset") image(grain, 0, 0, width, height);
}

function paintSky() {
  if (!skyLayer || skyLayer.width != width || skyLayer.height != height) {
    skyLayer = createGraphics(width, height);
    grain = makeGrain(width, height);
  }
  let g = skyLayer;
  if (skyName == "sunset") {
    g.background(120, 140, 170);
    if (skyPhoto) coverImage(g, skyPhoto);
  } else if (skyName == "day") {
    gradient(g, color(92, 138, 196), color(214, 228, 238));
    cloudLayer = makeClouds(width, height);
  } else {
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

function gradient(g, top, bottom) {
  for (let y = 0; y < g.height; y++) {
    g.stroke(lerpColor(top, bottom, pow(y / g.height, 1.3)));
    g.line(0, y, g.width, y);
  }
}

// Soft heaps of cloud. Painted small and scaled up so they stay soft and quick to draw;
// the pattern wraps round sideways so the layer can drift forever.
function makeClouds(w, h) {
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
      let c = constrain((v - 0.48) * 4.5, 0, 1) * fade;
      let i = (y * cw + x) * 4;
      let shade = 255 - (1 - y / ch) * 18 - c * 22; // a little grey in the thick parts
      small.pixels[i] = shade;
      small.pixels[i + 1] = shade;
      small.pixels[i + 2] = shade + 6;
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

function hookSkyButtons() {
  for (let b of document.querySelectorAll("#skies button")) {
    b.onclick = () => chooseSky(b.dataset.sky);
  }
}
