// Make: the idea-lab tools in the world. Select and move, text, images,
// shapes, straight paths, pen colour, and scissors for cutting your own
// things out of photos. Used by sketch.js.

let penColour = null; // null: the usual ink for where she is (white at night)
let PEN_COLOURS = [null, "#1a1714", "#f7f3ea", "#8f1d1d", "#c8432f", "#e8a33d", "#2f6b8f", "#5d8a4e", "#e9a0b3", "#7a5c99", "#8a6a4a"];
let shape = "rect";
let shapeDraft = null; // { x0, y0, x1, y1 } while dragging out a shape
let pathDraft = null; // points clicked so far
let moving = null; // { item, kind, from, before, moved }
let TEXT_SIZE = 24;

function pushUndo() {
  room().history.push({ snapshot: roomSnapshot() });
}

// ---- pen colour ----

function lineColour(l) {
  return l.colour || inkHere();
}

function hookColours() {
  let picker = document.getElementById("colourPicker");
  for (let c of PEN_COLOURS) {
    let b = document.createElement("button");
    b.className = "swatch" + (c ? "" : " auto");
    b.style.setProperty("--swatch", c || "linear-gradient(135deg, #1a1714 50%, #f7f3ea 50%)");
    if (!c) b.style.background = "linear-gradient(135deg, #1a1714 50%, #f7f3ea 50%)";
    b.title = c ? "Pen colour" : "Ink: black, or white at night";
    b.setAttribute("aria-label", b.title);
    b.onclick = () => {
      penColour = c;
      markColour();
      picker.hidden = true;
      document.getElementById("colourButton").setAttribute("aria-expanded", false);
    };
    picker.appendChild(b);
  }
  let button = document.getElementById("colourButton");
  button.onclick = () => {
    picker.hidden = !picker.hidden;
    button.setAttribute("aria-expanded", !picker.hidden);
    let r = button.getBoundingClientRect();
    picker.style.top = max(6, r.top - 40) + "px";
  };
  markColour();
}

function markColour() {
  document.documentElement.style.setProperty("--pen", penColour || "#1a1714");
}

// ---- shapes ----

function hookShapes() {
  for (let b of document.querySelectorAll("#shapePicker [data-shape]")) {
    b.onclick = () => {
      shape = b.dataset.shape;
      markShape();
      document.getElementById("shapePicker").hidden = true;
      showStatus("Drag to draw a " + (shape == "ellipse" ? "circle" : shape == "rect" ? "rectangle" : shape == "line" ? "straight line" : "triangle") + ".");
    };
  }
  markShape();
}

function markShape() {
  for (let b of document.querySelectorAll("#shapePicker [data-shape]")) b.classList.toggle("on", b.dataset.shape == shape);
}

function showShapePicker() {
  let picker = document.getElementById("shapePicker");
  let r = document.querySelector('[data-tool="shapes"]').getBoundingClientRect();
  picker.style.top = r.top + "px";
  picker.hidden = false;
}

function shapePoints(d) {
  let x0 = min(d.x0, d.x1);
  let y0 = min(d.y0, d.y1);
  let x1 = max(d.x0, d.x1);
  let y1 = max(d.y0, d.y1);
  if (shape == "line") return [{ x: d.x0, y: d.y0 }, { x: d.x1, y: d.y1 }];
  if (shape == "rect") return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 - 1 }];
  if (shape == "triangle") return [{ x: (x0 + x1) / 2, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: (x0 + x1) / 2 - 0.5, y: y0 + 1 }];
  let pts = [];
  for (let i = 0; i <= 64; i++) {
    let a = (i / 64) * TWO_PI;
    pts.push({ x: (x0 + x1) / 2 + (cos(a) * (x1 - x0)) / 2, y: (y0 + y1) / 2 + (sin(a) * (y1 - y0)) / 2 });
  }
  return pts;
}

function finishShape() {
  let d = shapeDraft;
  shapeDraft = null;
  if (dist(d.x0, d.y0, d.x1, d.y1) < 8) return;
  pushUndo();
  let l = seeded(shapePoints(d), random(1000));
  if (shape != "ellipse") l.sharp = true;
  if (penColour) l.colour = penColour;
  lines.push(l);
  inkDirty = true;
  saveWorld();
}

// ---- straight paths, point to point ----

function pathClick(x, y) {
  if (!pathDraft) {
    pathDraft = [{ x, y }];
    showStatus("Click to add points. Double-click, press Enter, or click the last point to finish.");
    return;
  }
  let last = pathDraft[pathDraft.length - 1];
  if (dist(last.x, last.y, x, y) < 8) return finishPath();
  pathDraft.push({ x, y });
}

function finishPath() {
  let pts = pathDraft;
  pathDraft = null;
  document.getElementById("status").hidden = true;
  if (!pts || pts.length < 2) return;
  pushUndo();
  let l = seeded(pts, random(1000));
  l.sharp = true;
  if (penColour) l.colour = penColour;
  lines.push(l);
  inkDirty = true;
  saveWorld();
}

function doubleClicked() {
  if (tool == "path" && pathDraft) {
    pathDraft.pop(); // the double-click's second click added a point on the same spot
    finishPath();
  }
}

// ---- text ----

function textAt(x, y) {
  return [...(room().texts || [])].reverse().find((t) => {
    let w = textWidthOf(t);
    return x >= t.x - 4 && x <= t.x + w + 4 && y >= t.y - t.size && y <= t.y + t.size * 0.3;
  });
}

function textWidthOf(t) {
  push();
  textFont("Comic Neue");
  textSize(t.size);
  let w = max(...t.text.split("\n").map((s) => textWidth(s)));
  pop();
  return w;
}

function inkText(g, t) {
  g.push();
  g.noStroke();
  g.fill(t.colour || inkHere());
  g.textFont("Comic Neue");
  g.textStyle(BOLD);
  g.textSize(t.size);
  g.textAlign(LEFT, BASELINE);
  g.text(t.text, t.x, t.y);
  g.pop();
}

// a box to type in, where the words will be; Enter or clicking away puts them down
function writeText(x, y, existing) {
  let box = document.createElement("div");
  box.className = "world-text";
  box.contentEditable = "true";
  box.spellcheck = false;
  let size = existing ? existing.size : TEXT_SIZE;
  let canvasBox = drawingContext.canvas.getBoundingClientRect();
  box.style.left = canvasBox.left + x - 6 + "px";
  box.style.top = canvasBox.top + y - size - 4 + "px";
  box.style.fontSize = size + "px";
  box.style.fontWeight = "700";
  box.style.color = (existing && existing.colour) || penColour || (inkHere() == 240 ? "#f0f0f0" : "#1a1714");
  box.textContent = existing ? existing.text : "";
  document.body.appendChild(box);
  // focus once the click that made it is over, or the click takes the focus straight back
  setTimeout(() => {
    box.focus();
    box.onblur = finish;
  }, 0);
  if (existing) {
    existing.hidden = true;
    inkDirty = true;
  }
  let done = false;
  let finish = () => {
    if (done) return;
    done = true;
    let words = box.innerText.trim();
    box.remove();
    pushUndo();
    if (existing) {
      existing.hidden = false;
      if (words) existing.text = words;
      else room().texts = room().texts.filter((t) => t != existing);
    } else if (words) {
      room().texts.push({ x, y, text: words, size, colour: penColour });
    } else room().history.pop();
    inkDirty = true;
    saveWorld();
  };
  box.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key == "Enter" && !e.shiftKey) {
      e.preventDefault();
      finish();
    }
    if (e.key == "Escape") finish();
  };
}

// ---- select and move ----

function itemAt(x, y) {
  let r = room();
  let t = textAt(x, y);
  if (t) return { item: t, kind: "text" };
  let { w: dw, h: dh } = doorSize();
  let thing = [...r.things].reverse().find((t) => {
    let { w, h } = thingSize(t);
    return abs(x - t.x) < w / 2 && y < t.y && y > t.y - h;
  });
  if (thing) return { item: thing, kind: "thing" };
  let door = [...r.doors].reverse().find((d) => abs(x - d.x) < dw / 2 && y < d.y && y > d.y - dh);
  if (door) return { item: door, kind: "door" };
  let frame = frameAt(x, y);
  if (frame) return { item: frame, kind: "frame" };
  let line = [...lines].reverse().find((l) => {
    for (let i = 1; i < l.length; i++) if (distToSegment(x, y, l[i - 1], l[i]) < 8) return true;
    return false;
  });
  if (line) return { item: line, kind: "line" };
  return null;
}

function distToSegment(x, y, a, b) {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let t = constrain(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return dist(x, y, a.x + t * dx, a.y + t * dy);
}

function startMove(x, y) {
  let hit = itemAt(x, y);
  if (!hit) return;
  moving = { ...hit, from: { x, y }, before: roomSnapshot(), moved: false };
}

function moveItemTo(x, y) {
  let dx = x - moving.from.x;
  let dy = y - moving.from.y;
  if (!dx && !dy) return;
  moving.from = { x, y };
  moving.moved = true;
  let it = moving.item;
  if (moving.kind == "line") for (let p of it) (p.x += dx), (p.y += dy);
  else it.x += dx, it.y += dy;
  inkDirty = true;
}

function endMove() {
  let m = moving;
  moving = null;
  if (!m.moved) return;
  // doors and things settle onto the line beneath them
  if (m.kind == "door" || m.kind == "thing") {
    let list = m.kind == "door" ? room().doors : room().things;
    let i = list.indexOf(m.item);
    list.splice(i, 1);
    let base = groundBelow(m.item.x, m.item.y - 30);
    m.item.y = base == null ? floorY() : base;
    list.splice(i, 0, m.item);
  }
  room().history.push({ snapshot: m.before });
  inkDirty = true;
  saveWorld();
}

// a move cursor over anything the select tool can pick up
function drawSelectHover() {
  let over = tool == "select" && !mapOpen && !editingFrame && (moving || itemAt(mouseX, mouseY));
  drawingContext.canvas.style.cursor = over ? "move" : "";
}

// ---- images, without a frame ----

function finishImage() {
  let d = frameDraft;
  frameDraft = null;
  let w = abs(d.x1 - d.x0);
  let h = abs(d.y1 - d.y0);
  let f = w > 24 && h > 24 ? { x: min(d.x0, d.x1), y: min(d.y0, d.y1), w, h } : { x: d.x0 - 90, y: d.y0 - 60, w: 180, h: 120 };
  f.seed = random(1000);
  f.art = null;
  f.bare = true;
  pushUndo();
  room().frames.push(f);
  inkDirty = true;
  // the photo picker opens straight away; the image takes the photo's shape
  let input = document.getElementById("artPhotoInput");
  pendingImage = f;
  setTool("draw");
  input.click();
}
let pendingImage = null;

function fillImage(f, file) {
  fileToImage(file).then((el) => {
    // keep the photo's proportions, fitted to the box that was drawn
    let s = min(f.w / el.naturalWidth, f.h / el.naturalHeight);
    let w = el.naturalWidth * s;
    let h = el.naturalHeight * s;
    f.x += (f.w - w) / 2;
    f.y += (f.h - h) / 2;
    f.w = w;
    f.h = h;
    let c = document.createElement("canvas");
    let big = 900 / max(el.naturalWidth, el.naturalHeight);
    c.width = round(el.naturalWidth * min(1, big));
    c.height = round(el.naturalHeight * min(1, big));
    c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);
    f.art = c.toDataURL("image/jpeg", 0.88);
    inkDirty = true;
    saveWorld();
  }, () => showStatus("Couldn't open that picture. Try a JPG or PNG.", 4000));
}

// ---- scissors: your own cutouts ----

let cut = null; // { img, lasso, scale }

function openCutEditor() {
  cut = { img: null, lasso: [], drawing: false };
  document.getElementById("cutName").value = "";
  document.getElementById("cutEditor").hidden = false;
  let c = document.getElementById("cutCanvas");
  c.width = 640;
  c.height = 420;
  paintCut();
}

function closeCutEditor() {
  cut = null;
  document.getElementById("cutEditor").hidden = true;
  if (tool == "scissors") setTool("draw");
}

function paintCut() {
  let c = document.getElementById("cutCanvas");
  let ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  if (!cut.img) {
    ctx.fillStyle = "#6b6357";
    ctx.font = '18px "Comic Neue", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("Choose a photo to cut something out of", c.width / 2, c.height / 2);
    return;
  }
  ctx.drawImage(cut.img, 0, 0, c.width, c.height);
  if (cut.lasso.length > 1) {
    ctx.save();
    if (!cut.drawing) {
      // dim everything outside the loop
      ctx.fillStyle = "rgba(20, 18, 16, 0.55)";
      ctx.beginPath();
      ctx.rect(0, 0, c.width, c.height);
      lassoPath(ctx, cut.lasso, 1);
      ctx.fill("evenodd");
    }
    ctx.beginPath();
    lassoPath(ctx, cut.lasso, 1);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = "#222";
    ctx.stroke();
    ctx.restore();
  }
}

function lassoPath(ctx, pts, s) {
  ctx.moveTo(pts[0].x * s, pts[0].y * s);
  for (let p of pts) ctx.lineTo(p.x * s, p.y * s);
  ctx.closePath();
}

function loadCutPhoto(file) {
  fileToImage(file).then((el) => {
    let c = document.getElementById("cutCanvas");
    let fit = min(760 / el.naturalWidth, 500 / el.naturalHeight, 1);
    c.width = round(el.naturalWidth * fit);
    c.height = round(el.naturalHeight * fit);
    cut.img = el;
    cut.lasso = [];
    document.getElementById("cutHelp").textContent = "Draw a loop around the part you want.";
    paintCut();
  }, () => showStatus("Couldn't open that picture. Try a JPG or PNG.", 4000));
}

// cut the loop out of the photo at a good size, with soft edges, and make it a thing
function finishCut() {
  if (!cut || !cut.img || cut.lasso.length < 3) {
    document.getElementById("cutHelp").textContent = "Choose a photo and draw a loop around something first.";
    return;
  }
  let c = document.getElementById("cutCanvas");
  let s = min(cut.img.naturalWidth / c.width, 2.5);
  let xs = cut.lasso.map((p) => p.x);
  let ys = cut.lasso.map((p) => p.y);
  let bx = min(xs), by = min(ys), bw = max(xs) - bx, bh = max(ys) - by;
  if (bw < 6 || bh < 6) return;
  let out = document.createElement("canvas");
  let fit = min(1, 520 / (bh * s), 520 / (bw * s));
  out.width = round(bw * s * fit);
  out.height = round(bh * s * fit);
  let ctx = out.getContext("2d");
  let k = s * fit;
  ctx.save();
  ctx.beginPath();
  lassoPath(ctx, cut.lasso.map((p) => ({ x: p.x - bx, y: p.y - by })), k);
  ctx.clip();
  ctx.drawImage(cut.img, -bx * k, -by * k, c.width * k, c.height * k); // the photo as shown, scaled up to k
  ctx.restore();
  let art = out.toDataURL("image/png");
  let name = document.getElementById("cutName").value.trim() || "Cutout " + (cutouts.length + 1);
  let id = "cut" + Date.now().toString(36);
  let cutout = { id, label: name, art, height: 0.6, tops: topsOf(out) };
  cutouts.push(cutout);
  addCutoutThing(cutout);
  fillThingChoices();
  saveWorld();
  cut = null;
  document.getElementById("cutEditor").hidden = true;
  setPlacingThing(id);
}

// where she could stand on a cutout: the flattest stretch along its top edge
function topsOf(canvas) {
  let ctx = canvas.getContext("2d");
  let { width: w, height: h } = canvas;
  let data = ctx.getImageData(0, 0, w, h).data;
  let tops = [];
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h && data[(y * w + x) * 4 + 3] < 128) y++;
    tops.push(y < h ? y : null);
  }
  let solid = tops.filter((y) => y != null).sort((a, b) => a - b);
  if (!solid.length) return [];
  let level = solid[floor(solid.length * 0.3)];
  let near = tops.map((y, x) => (y != null && abs(y - level) < h * 0.06 ? x : null)).filter((x) => x != null);
  return [{ y: level / h, x1: near[0] / w, x2: near[near.length - 1] / w }];
}

let cutouts = [];

function addCutoutThing(c) {
  THINGS[c.id] = { label: c.label, art: c.art, height: c.height, tops: c.tops };
  urlToImage(c.art).then((el) => {
    let img = createImage(el.naturalWidth, el.naturalHeight);
    img.drawingContext.drawImage(el, 0, 0);
    thingPictures[c.id] = img;
    for (let r of rooms) r.ink = null;
    inkDirty = true;
  }, () => {});
}

function hookCut() {
  let c = document.getElementById("cutCanvas");
  let at = (e) => {
    let r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };
  c.onpointerdown = (e) => {
    if (!cut || !cut.img) return;
    c.setPointerCapture(e.pointerId);
    cut.lasso = [at(e)];
    cut.drawing = true;
    paintCut();
  };
  c.onpointermove = (e) => {
    if (!cut || !cut.drawing) return;
    cut.lasso.push(at(e));
    paintCut();
  };
  c.onpointerup = c.onpointercancel = () => {
    if (!cut || !cut.drawing) return;
    cut.drawing = false;
    paintCut();
  };
  let input = document.getElementById("cutPhotoInput");
  document.getElementById("cutPhoto").onclick = () => input.click();
  input.onchange = () => {
    if (input.files[0]) loadCutPhoto(input.files[0]);
    input.value = "";
  };
  document.getElementById("cutCancel").onclick = closeCutEditor;
  document.getElementById("cutDone").onclick = finishCut;
}

// ---- drawing the drafts ----

function drawDrafts() {
  push();
  noFill();
  stroke(penColour || inkHere());
  strokeWeight(2.5);
  if (shapeDraft) {
    beginShape();
    for (let p of shapePoints(shapeDraft)) vertex(p.x, p.y);
    endShape();
  }
  if (pathDraft) {
    beginShape();
    for (let p of pathDraft) vertex(p.x, p.y);
    vertex(mouseX, mouseY);
    endShape();
    noStroke();
    fill(penColour || inkHere());
    for (let p of pathDraft) circle(p.x, p.y, 6);
  }
  pop();
}

function hookMake() {
  hookColours();
  hookShapes();
  hookCut();
  document.getElementById("help").onclick = () => {
    let hint = document.getElementById("hint");
    hint.hidden = !hint.hidden;
  };
  document.fonts.load('700 24px "Comic Neue"').then(() => {
    for (let r of rooms) r.ink = null;
    inkDirty = true;
  });
}
