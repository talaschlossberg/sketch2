// Frames: clean up a walk sequence and work out
// how far he travels per frame. Used by sketch.js.

let PAPER = [255, 255, 255];

// Turn plain <img> elements into p5 images plus everything drawGuy needs.
function prepareFrames(els) {
  let imgs = els.map((el) => {
    let img = createImage(el.naturalWidth, el.naturalHeight);
    img.drawingContext.drawImage(el, 0, 0);
    let data = img.drawingContext.getImageData(0, 0, img.width, img.height);
    // photos and video are used as they are; only line drawings get cleaned up
    if (isLineArt(data)) {
      clearBackground(data);
      fillInside(data);
      img.drawingContext.putImageData(data, 0, 0);
    }
    return img;
  });

  let crop = findCrop(imgs);

  // how far apart his feet are in each frame, measured across the bottom of the drawing
  let spreads = imgs.map((img) => feetSpread(img, crop));
  let narrowest = min(spreads);
  let widest = max(spreads);
  let n = imgs.length;

  // each wide stance is one step; a sequence can hold one step or several
  let steps = 0;
  for (let i = 0; i < n; i++) {
    let s = spreads[i];
    let before = spreads[(i - 1 + n) % n];
    let after = spreads[(i + 1) % n];
    if (s > before && s >= after && s > (narrowest + widest) / 2) steps++;
  }
  steps = max(1, steps);

  let stepLength = (widest - narrowest) / crop.h; // as a share of his height
  if (stepLength < 0.1) stepLength = 0.4; // feet barely move: guess a normal step

  return {
    imgs,
    crop,
    standing: spreads.indexOf(narrowest),
    jumping: spreads.indexOf(widest),
    stepPerFrame: (stepLength * steps) / n, // share of his height per frame
  };
}

// Line drawings are almost all black and white; photos have colour and mid tones.
function isLineArt(data) {
  let p = data.data;
  let solid = 0;
  let toned = 0;
  for (let i = 0; i < p.length; i += 16) {
    if (p[i + 3] < 128) continue;
    solid++;
    let hi = max(p[i], p[i + 1], p[i + 2]);
    let lo = min(p[i], p[i + 1], p[i + 2]);
    let grey = (p[i] + p[i + 1] + p[i + 2]) / 3;
    if (hi - lo > 40 || (grey > 60 && grey < 200)) toned++;
  }
  return toned < solid * 0.03;
}

// Frames drawn on white instead of a transparent background: make the paper see-through.
function clearBackground(data) {
  let p = data.data;
  let corners = [0, data.width - 1, (data.height - 1) * data.width, data.height * data.width - 1];
  if (!corners.every((i) => p[i * 4 + 3] > 200)) return;
  for (let i = 0; i < p.length; i += 4) {
    let dark = 255 - (p[i] + p[i + 1] + p[i + 2]) / 3;
    p[i + 3] = constrain(dark * 1.4, 0, 255);
  }
}

// Paint the inside of his outline with paper, so lines behind him don't show through.
// Small gaps in the outline are closed first so the paint doesn't leak out.
function fillInside(data) {
  let w = data.width;
  let h = data.height;
  let p = data.data;
  let ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = p[i * 4 + 3] > 40 ? 1 : 0;

  let closed = grow(ink, w, h, 4);

  // everything reachable from the edge without crossing ink is outside
  let outside = new Uint8Array(w * h);
  let stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    let i = stack.pop();
    if (outside[i] || closed[i]) continue;
    outside[i] = 1;
    let x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < w * (h - 1)) stack.push(i + w);
  }
  // pull the paint back off the closed-up gaps
  outside = grow(outside, w, h, 2);

  for (let i = 0; i < w * h; i++) {
    if (outside[i]) continue;
    let a = p[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) p[i * 4 + c] = p[i * 4 + c] * a + PAPER[c] * (1 - a);
    p[i * 4 + 3] = 255;
  }
}

// mask grown by r pixels in every direction
function grow(mask, w, h, r) {
  let across = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -Infinity;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) last = x;
      if (x - last <= r) across[y * w + x] = 1;
    }
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[y * w + x]) last = x;
      if (last - x <= r) across[y * w + x] = 1;
    }
  }
  let out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) {
      if (across[y * w + x]) last = y;
      if (y - last <= r) out[y * w + x] = 1;
    }
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (across[y * w + x]) last = y;
      if (last - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}

// smallest box that holds the drawing in every frame
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

function feetSpread(img, crop) {
  let left = Infinity;
  let right = -1;
  let w = img.width;
  for (let y = floor(crop.y + crop.h * 0.9); y < crop.y + crop.h; y++) {
    for (let x = crop.x; x < crop.x + crop.w; x++) {
      if (img.pixels[(y * w + x) * 4 + 3] > 20) {
        left = min(left, x);
        right = max(right, x);
      }
    }
  }
  return right < 0 ? 0 : right - left;
}

// ---- getting the files ----

function fileToImage(blob) {
  return new Promise((done, fail) => {
    let el = new Image();
    el.onload = () => done(el);
    el.onerror = fail;
    el.src = URL.createObjectURL(blob);
  });
}

// ---- the browser's store, where the world is kept ----

function openStore() {
  return new Promise((done, fail) => {
    let req = indexedDB.open("walk", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("saved");
    req.onsuccess = () => done(req.result);
    req.onerror = () => fail(req.error);
  });
}

