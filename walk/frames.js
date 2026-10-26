// Frames: load a walk sequence from a folder, clean it up, and work out
// how far he travels per frame. Used by sketch.js.

let PAPER = [255, 255, 255];

// Turn plain <img> elements into p5 images plus everything drawGuy needs.
function prepareFrames(els) {
  let imgs = els.map((el) => {
    let img = createImage(el.naturalWidth, el.naturalHeight);
    img.drawingContext.drawImage(el, 0, 0);
    let data = img.drawingContext.getImageData(0, 0, img.width, img.height);
    clearBackground(data);
    fillInside(data);
    img.drawingContext.putImageData(data, 0, 0);
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

function isImageFile(f) {
  return /\.(png|jpe?g|gif|webp)$/i.test(f.name);
}

function sortByName(files) {
  return files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function fileToImage(blob) {
  return new Promise((done, fail) => {
    let el = new Image();
    el.onload = () => done(el);
    el.onerror = fail;
    el.src = URL.createObjectURL(blob);
  });
}

// everything dropped: files, folders, folders inside folders
async function droppedFiles(dataTransfer) {
  let entries = [...dataTransfer.items].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
  if (entries.length == 0) return [...dataTransfer.files];
  let files = [];
  async function walk(entry) {
    if (entry.isFile) {
      files.push(await new Promise((done, fail) => entry.file(done, fail)));
    } else if (entry.isDirectory) {
      let reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((done, fail) => reader.readEntries(done, fail));
        for (let e of batch) await walk(e);
      } while (batch.length);
    }
  }
  for (let e of entries) await walk(e);
  return files;
}

// ---- remembering the last folder in this browser ----

function openStore() {
  return new Promise((done, fail) => {
    let req = indexedDB.open("walk", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("saved");
    req.onsuccess = () => done(req.result);
    req.onerror = () => fail(req.error);
  });
}

async function rememberFrames(files, drawnFacing) {
  try {
    let db = await openStore();
    let tx = db.transaction("saved", "readwrite");
    tx.objectStore("saved").put({ files: files.map((f) => ({ name: f.name, blob: f })), drawnFacing }, "frames");
  } catch (e) {
    // private window or storage blocked: it just won't be remembered
  }
}

async function rememberedFrames() {
  try {
    let db = await openStore();
    return await new Promise((done) => {
      let req = db.transaction("saved").objectStore("saved").get("frames");
      req.onsuccess = () => done(req.result || null);
      req.onerror = () => done(null);
    });
  } catch (e) {
    return null;
  }
}
