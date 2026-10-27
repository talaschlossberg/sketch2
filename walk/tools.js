// Tools: the rail down the left, which tool is in hand, and the eraser.
// Used by sketch.js.

let tool = "draw";
let erasing = false; // dragging the eraser over lines
let ERASER = 14; // radius

let TOOL_HELP = {
  select: "Drag anything to move it. Drag the corner square to resize, or press + and -. Portal, in the bar, makes a photo or drawing lead to another page.",
  image: "Drag a box where the photo should go, then choose a photo.",
  path: "Click from point to point. Double-click or press Enter to finish.",
  fill: "Click inside a shape you've drawn to fill it.",
  erase: "Drag over lines to rub them out. Click a door, photo or fill to take it away.",
  door: "Click on a line to put a door there.",
};

function setTool(name) {
  if (name != "select") selected = null;
  if (pathDraft && name != "path") finishPath();
  tool = name;
  placingDoor = name == "door";
  for (let b of document.querySelectorAll("[data-tool]")) b.classList.toggle("on", b.dataset.tool == name);
  document.getElementById("fillPicker").hidden = true;
  document.body.classList.toggle("erasing", name == "erase");
  document.body.dataset.using = name;
  if (TOOL_HELP[name]) showStatus(TOOL_HELP[name], 5000, "tool-" + name);
  else document.getElementById("status").hidden = true;
  if (name == "fill") showFillPicker();
}

function hookTools() {
  for (let b of document.querySelectorAll("[data-tool]")) {
    b.onclick = () => setTool(tool == b.dataset.tool && !["draw", "fill"].includes(b.dataset.tool) ? "draw" : b.dataset.tool);
  }
  setTool("draw");
}

// the world fills whatever the rail and the bar leave
function worldWidth() {
  return windowWidth - cssPixels("--rail");
}

function worldHeight() {
  return windowHeight - cssPixels("--bar");
}

function cssPixels(name) {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

// ---- erasing ----

// what's in the room now, so Undo can put back whatever the eraser takes
function roomSnapshot() {
  let r = room();
  return {
    lines: r.lines.map((l) => likeLine(l.map((p) => ({ ...p })), l)),
    // copies, so moving or resizing something afterwards can't change what Undo puts back
    doors: r.doors.map((d) => ({ ...d })),
    images: r.images.map((f) => ({ ...f })),
    fills: [...r.fills],
  };
}

function restoreSnapshot(snap) {
  let r = room();
  r.lines.length = 0;
  r.lines.push(...snap.lines);
  r.doors = snap.doors;
  r.images = snap.images;
  r.fills = snap.fills;
}

function eraseStart(x, y) {
  let before = roomSnapshot();
  let r = room();
  // a door, photo or fill under the eraser goes in one click
  let door = [...r.doors].reverse().find((d) => abs(x - d.x) < doorSize(d).w / 2 && y < d.y && y > d.y - doorSize(d).h);
  let image = !door && imageAt(x, y);
  let nearLine = lines.some((l) => l.some((p, i) => i > 0 && distToSegment(x, y, l[i - 1], p) < ERASER));
  let paint = !door && !image && !nearLine && fillAtPoint(x, y);
  if (door) r.doors = r.doors.filter((d) => d != door);
  else if (image) r.images = r.images.filter((f) => f != image);
  else if (paint) r.fills = r.fills.filter((f) => f != paint);
  if (door || image || paint) {
    r.history.push({ snapshot: before });
    inkDirty = true;
    saveWorld();
    return;
  }
  erasing = { before, changed: false };
  eraseAt(x, y);
}

// cut away the parts of lines inside the eraser, splitting them where it passes through
function eraseAt(x, y) {
  let kept = [];
  let changed = false;
  for (let l of lines) {
    let pts = densify(l, 3);
    let piece = [];
    let pieces = [];
    let hit = false;
    for (let p of pts) {
      if (dist(p.x, p.y, x, y) < ERASER) {
        hit = true;
        if (piece.length > 1) pieces.push(piece);
        piece = [];
      } else piece.push(p);
    }
    if (piece.length > 1) pieces.push(piece);
    if (!hit) {
      kept.push(l); // untouched: keep it as it was
      continue;
    }
    changed = true;
    pieces.forEach((pc, i) => kept.push(likeLine(pc, l, l.seed + i * 17)));
  }
  if (!changed) return;
  lines.length = 0;
  lines.push(...kept);
  erasing.changed = true;
  inkDirty = true;
}

function eraseEnd() {
  if (erasing.changed) {
    room().history.push({ snapshot: erasing.before });
    saveWorld();
  }
  erasing = false;
}

// new points with the same look as line l: its wobble, sharp corners and colour
function likeLine(pts, l, seed = l.seed) {
  seeded(pts, seed);
  if (l.sharp) pts.sharp = true;
  if (l.colour) pts.colour = l.colour;
  if (l.portal) (pts.portal = true), (pts.to = l.to);
  return pts;
}

// extra points along long segments, so the eraser can cut anywhere
function densify(l, step) {
  let out = [l[0]];
  for (let i = 1; i < l.length; i++) {
    let a = l[i - 1];
    let b = l[i];
    let n = floor(dist(a.x, a.y, b.x, b.y) / step);
    for (let k = 1; k < n; k++) out.push({ x: lerp(a.x, b.x, k / n), y: lerp(a.y, b.y, k / n) });
    out.push(b);
  }
  return out;
}

function drawEraserCursor() {
  if (tool != "erase" || mapOpen) return;
  if (mouseX < 0 || mouseY < 0 || mouseX > width || mouseY > height) return;
  push();
  noFill();
  stroke(255);
  strokeWeight(3);
  circle(mouseX, mouseY, ERASER * 2);
  stroke(inkHere());
  strokeWeight(1.5);
  circle(mouseX, mouseY, ERASER * 2);
  pop();
}
