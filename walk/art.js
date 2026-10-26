// Art: frames on the wall with art inside. Drag out a frame, then draw in it
// or put a photo in it. Click a frame later to change its art. Used by sketch.js.

let placingFrame = false;
let frameDraft = null; // the frame being dragged out: { x0, y0, x1, y1 }
let editingFrame = null;
let artPictures = new WeakMap(); // frame -> { src, img } once its art has loaded
let pen = { colour: "#1a1714", size: 6, erasing: false };

let PENS = ["#1a1714", "#f7f3ea", "#c8432f", "#e8a33d", "#2f6b8f", "#5d8a4e", "#e9a0b3"];
let MAT = "#f7f3ea";

function frameAt(x, y) {
  return [...room().frames].reverse().find((f) => x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h);
}

function inkFrame(g, f) {
  g.fill(MAT);
  g.rect(f.x, f.y, f.w, f.h);
  let pic = artPicture(f);
  if (pic) g.image(pic, f.x, f.y, f.w, f.h);
  else if (!f.art) {
    g.fill(150);
    g.textAlign(CENTER, CENTER);
    g.textSize(12);
    g.text("click to make art", f.x + f.w / 2, f.y + f.h / 2);
  }
  g.fill(inkHere());
  let box = (x, y, w, h) => sharp([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y: y - 1 }]);
  inkLine(g, box(f.x, f.y, f.w, f.h), f.seed);
  inkLine(g, box(f.x - 7, f.y - 7, f.w + 14, f.h + 14), f.seed + 1);
}

// the frame's art as a p5 image; loads it the first time and redraws when it's ready
function artPicture(f) {
  if (!f.art) return null;
  let known = artPictures.get(f);
  if (known && known.src == f.art) return known.img;
  if (!known || known.src != f.art) {
    let entry = { src: f.art, img: null };
    artPictures.set(f, entry);
    urlToImage(f.art).then((el) => {
      let img = createImage(el.naturalWidth, el.naturalHeight);
      img.drawingContext.drawImage(el, 0, 0);
      entry.img = img;
      for (let r of rooms) if (r.frames.includes(f)) r.ink = null;
      inkDirty = true;
    }, () => {});
  }
  return null;
}

// ---- putting frames up ----

function setPlacingFrame(on) {
  setTool(on ? "frame" : "draw");
}

function startFrame(x, y) {
  frameDraft = { x0: x, y0: y, x1: x, y1: y };
}

function finishFrame() {
  let d = frameDraft;
  frameDraft = null;
  setPlacingFrame(false);
  let w = abs(d.x1 - d.x0);
  let h = abs(d.y1 - d.y0);
  // a click without a drag puts up a frame of a usual size
  let f = w > 24 && h > 24 ? { x: min(d.x0, d.x1), y: min(d.y0, d.y1), w, h } : { x: d.x0 - 70, y: d.y0 - 55, w: 140, h: 110 };
  f.seed = random(1000);
  f.art = null;
  room().frames.push(f);
  room().history.push("frame");
  inkDirty = true;
  saveWorld();
  openArtEditor(f);
}

function drawFrameDraft() {
  if (!frameDraft) return;
  let d = frameDraft;
  push();
  noFill();
  stroke(inkHere());
  strokeWeight(2);
  drawingContext.setLineDash([8, 6]);
  rect(min(d.x0, d.x1), min(d.y0, d.y1), abs(d.x1 - d.x0), abs(d.y1 - d.y0));
  drawingContext.setLineDash([]);
  pop();
}

// ---- the art editor ----

function openArtEditor(f) {
  editingFrame = f;
  let box = document.getElementById("artEditor");
  let canvas = document.getElementById("artCanvas");
  // drawn at a decent size whatever the frame's size on the wall
  let s = 700 / max(f.w, f.h);
  canvas.width = round(f.w * s);
  canvas.height = round(f.h * s);
  let ctx = canvas.getContext("2d");
  ctx.fillStyle = MAT;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (f.art) urlToImage(f.art).then((el) => ctx.drawImage(el, 0, 0, canvas.width, canvas.height));
  box.hidden = false;
  fitArtCanvas();
}

function fitArtCanvas() {
  let canvas = document.getElementById("artCanvas");
  let maxW = min(window.innerWidth - 64, 820);
  let maxH = window.innerHeight - 220;
  let s = min(maxW / canvas.width, maxH / canvas.height);
  canvas.style.width = canvas.width * s + "px";
  canvas.style.height = canvas.height * s + "px";
}

function closeArtEditor(keep) {
  let f = editingFrame;
  if (!f) return;
  if (keep) {
    f.art = document.getElementById("artCanvas").toDataURL("image/jpeg", 0.88);
    inkDirty = true;
    saveWorld();
  }
  editingFrame = null;
  document.getElementById("artEditor").hidden = true;
}

function deleteEditingFrame(button) {
  if (!button.classList.contains("confirm")) {
    button.classList.add("confirm");
    button.textContent = "Delete it?";
    setTimeout(() => {
      button.classList.remove("confirm");
      button.textContent = "Delete frame";
    }, 2500);
    return;
  }
  button.classList.remove("confirm");
  button.textContent = "Delete frame";
  let r = room();
  r.frames = r.frames.filter((f) => f != editingFrame);
  let i = r.history.lastIndexOf("frame");
  if (i >= 0) r.history.splice(i, 1);
  editingFrame = null;
  document.getElementById("artEditor").hidden = true;
  inkDirty = true;
  saveWorld();
}

// a photo fills the frame, cropped to fit; you can draw over it after
function putPhotoInFrame(file) {
  let canvas = document.getElementById("artCanvas");
  fileToImage(file).then((el) => {
    let ctx = canvas.getContext("2d");
    let s = max(canvas.width / el.naturalWidth, canvas.height / el.naturalHeight);
    let w = el.naturalWidth * s;
    let h = el.naturalHeight * s;
    ctx.drawImage(el, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }, () => showStatus("Couldn't open that picture. Try a JPG or PNG.", 4000));
}

function hookArt() {
  let canvas = document.getElementById("artCanvas");
  let ctx = canvas.getContext("2d");
  let last = null;
  let at = (e) => {
    let r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * canvas.width) / r.width, y: ((e.clientY - r.top) * canvas.height) / r.height };
  };
  canvas.onpointerdown = (e) => {
    canvas.setPointerCapture(e.pointerId);
    last = at(e);
    ctx.fillStyle = pen.erasing ? MAT : pen.colour;
    ctx.beginPath();
    ctx.arc(last.x, last.y, pen.size / 2, 0, TWO_PI);
    ctx.fill();
  };
  canvas.onpointermove = (e) => {
    if (!last) return;
    let p = at(e);
    ctx.strokeStyle = pen.erasing ? MAT : pen.colour;
    ctx.lineWidth = pen.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  };
  canvas.onpointerup = canvas.onpointercancel = () => (last = null);

  let swatches = document.getElementById("artPens");
  for (let c of PENS) {
    let b = document.createElement("button");
    b.className = "swatch";
    b.style.setProperty("--swatch", c);
    b.setAttribute("aria-label", "Pen colour " + c);
    b.onclick = () => {
      pen.colour = c;
      pen.erasing = false;
      markPens();
    };
    b.dataset.colour = c;
    swatches.appendChild(b);
  }
  for (let b of document.querySelectorAll("#artSizes button")) {
    b.onclick = () => {
      pen.size = +b.dataset.size;
      markPens();
    };
  }
  document.getElementById("artEraser").onclick = () => {
    pen.erasing = !pen.erasing;
    markPens();
  };
  let photo = document.getElementById("artPhotoInput");
  document.getElementById("artPhoto").onclick = () => photo.click();
  photo.onchange = () => {
    if (photo.files[0]) putPhotoInFrame(photo.files[0]);
    photo.value = "";
  };
  document.getElementById("artClear").onclick = () => {
    ctx.fillStyle = MAT;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  document.getElementById("artDone").onclick = () => closeArtEditor(true);
  document.getElementById("artCancel").onclick = () => closeArtEditor(false);
  document.getElementById("artDelete").onclick = (e) => deleteEditingFrame(e.currentTarget);
  window.addEventListener("resize", () => editingFrame && fitArtCanvas());
  markPens();
}

function markPens() {
  for (let b of document.querySelectorAll("#artPens .swatch")) b.classList.toggle("on", !pen.erasing && b.dataset.colour == pen.colour);
  for (let b of document.querySelectorAll("#artSizes button")) b.classList.toggle("on", +b.dataset.size == pen.size);
  document.getElementById("artEraser").classList.toggle("on", pen.erasing);
}
