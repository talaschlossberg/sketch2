// Make: the path tool (straight lines, point to point) and the select tool
// (move and resize doors, photos and lines). Used by sketch.js.

let pathDraft = null; // points clicked so far
let moving = null; // { item, kind, from, before, moved }

function pushUndo() {
  room().history.push({ snapshot: roomSnapshot() });
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

// ---- select and move ----

function itemAt(x, y) {
  let r = room();
  let door = [...r.doors].reverse().find((d) => abs(x - d.x) < doorSize(d).w / 2 && y < d.y && y > d.y - doorSize(d).h);
  if (door) return { item: door, kind: "door" };
  let image = imageAt(x, y);
  if (image) return { item: image, kind: "image" };
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

// a click picks something up (and selects it); the corner handle of a selection resizes it
function startMove(x, y) {
  if (selected && stillHere(selected)) {
    let h = handleOf(selected);
    if (dist(x, y, h.x, h.y) < 14) return startScale(x, y);
  }
  let hit = itemAt(x, y);
  selected = hit;
  if (!hit) return;
  moving = { ...hit, from: { x, y }, before: roomSnapshot(), moved: false };
}

// ---- resizing ----

let selected = null; // { item, kind } picked with the select tool
let scaling = null;
let lastWheel = 0;
let lastNudged = null;

function stillHere(sel) {
  let r = room();
  let list = { door: r.doors, image: r.images, line: lines }[sel.kind];
  return list && list.includes(sel.item);
}

function boxOf(sel) {
  let it = sel.item;
  if (sel.kind == "door") {
    let { w, h } = doorSize(it);
    return { x: it.x - w / 2, y: it.y - h, w, h };
  }
  if (sel.kind == "image") return { x: it.x, y: it.y, w: it.w, h: it.h };
  let xs = it.map((p) => p.x);
  let ys = it.map((p) => p.y);
  return { x: min(xs), y: min(ys), w: max(xs) - min(xs), h: max(ys) - min(ys) };
}

// doors grow up from where they stand; everything else from its top left
function anchorOf(sel) {
  let b = boxOf(sel);
  if (sel.kind == "door") return { x: sel.item.x, y: sel.item.y };
  return { x: b.x, y: b.y };
}

function handleOf(sel) {
  let b = boxOf(sel);
  if (sel.kind == "door") return { x: b.x + b.w + 4, y: b.y - 4 };
  return { x: b.x + b.w + 4, y: b.y + b.h + 4 };
}

function sizeNow(sel) {
  let it = sel.item;
  if (sel.kind == "door") return { scale: it.scale || 1 };
  if (sel.kind == "image") return { w: it.w, h: it.h };
  return { pts: it.map((p) => ({ x: p.x, y: p.y })) };
}

// set the size to k times what it was (orig), keeping the anchor still
function applyScale(sel, orig, anchor, k) {
  let it = sel.item;
  if (sel.kind == "door") it.scale = constrain(orig.scale * k, 0.2, 6);
  else if (sel.kind == "image") {
    k = constrain(k, 20 / min(orig.w, orig.h), 2400 / max(orig.w, orig.h));
    it.w = orig.w * k;
    it.h = orig.h * k;
  } else orig.pts.forEach((p, i) => {
    it[i].x = anchor.x + (p.x - anchor.x) * k;
    it[i].y = anchor.y + (p.y - anchor.y) * k;
  });
  inkDirty = true;
}

function startScale(x, y) {
  let anchor = anchorOf(selected);
  let h = handleOf(selected);
  scaling = { sel: selected, anchor, from: max(10, dist(anchor.x, anchor.y, h.x, h.y)), orig: sizeNow(selected), before: roomSnapshot() };
}

function scaleTo(x, y) {
  let s = scaling;
  applyScale(s.sel, s.orig, s.anchor, dist(s.anchor.x, s.anchor.y, x, y) / s.from);
}

function endScale() {
  room().history.push({ snapshot: scaling.before });
  scaling = null;
  saveWorld();
}

// + and - keys, or the mouse wheel, nudge the selection's size
function nudgeScale(k) {
  if (!selected || !stillHere(selected)) return;
  // a run of nudges to one thing is one step for Undo
  if (millis() - lastWheel > 600 || lastNudged != selected.item) room().history.push({ snapshot: roomSnapshot() });
  lastWheel = millis();
  lastNudged = selected.item;
  applyScale(selected, sizeNow(selected), anchorOf(selected), k);
  saveWorld();
}

function mouseWheel(e) {
  if (tool != "select" || !selected || !stillHere(selected) || mapOpen) return;
  let b = boxOf(selected);
  if (mouseX < b.x - 20 || mouseX > b.x + b.w + 20 || mouseY < b.y - 20 || mouseY > b.y + b.h + 20) return;
  nudgeScale(exp(-e.delta * 0.0015));
  return false;
}

function drawSelection() {
  if (tool != "select" || !selected) return;
  if (!stillHere(selected)) return (selected = null);
  let b = boxOf(selected);
  let h = handleOf(selected);
  push();
  noFill();
  stroke(255);
  strokeWeight(3);
  rect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
  stroke(30);
  strokeWeight(1.5);
  drawingContext.setLineDash([6, 4]);
  rect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
  drawingContext.setLineDash([]);
  fill(255);
  stroke(30);
  strokeWeight(2);
  rect(h.x - 6, h.y - 6, 12, 12, 2);
  pop();
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
  // doors settle onto the line beneath them
  if (m.kind == "door") {
    let list = room().doors;
    let i = list.indexOf(m.item);
    list.splice(i, 1);
    let base = groundBelow(m.item.x, m.item.y - 30);
    m.item.y = base == null ? floorY() : base;
    m.item.floor = m.item.y >= floorY() - 2;
    list.splice(i, 0, m.item);
  }
  room().history.push({ snapshot: m.before });
  inkDirty = true;
  saveWorld();
}

// a move cursor over anything the select tool can pick up
function drawSelectHover() {
  let cursor = "";
  if (tool == "select" && !mapOpen) {
    let h = selected && stillHere(selected) && handleOf(selected);
    if (scaling || (h && dist(mouseX, mouseY, h.x, h.y) < 14)) cursor = "nwse-resize";
    else if (moving || itemAt(mouseX, mouseY)) cursor = "move";
  }
  drawingContext.canvas.style.cursor = cursor;
}

// ---- drawing the drafts ----

function drawDrafts() {
  push();
  noFill();
  stroke(inkHere());
  strokeWeight(2.5);
  if (pathDraft) {
    beginShape();
    for (let p of pathDraft) vertex(p.x, p.y);
    vertex(mouseX, mouseY);
    endShape();
    noStroke();
    fill(inkHere());
    for (let p of pathDraft) circle(p.x, p.y, 6);
  }
  pop();
}

function hookMake() {
  document.getElementById("help").onclick = () => {
    let hint = document.getElementById("hint");
    hint.hidden = !hint.hidden;
  };
}
