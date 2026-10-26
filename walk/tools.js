// Tools: the panel down the left, which tool is in hand, and the eraser.
// Used by sketch.js.

let tool = "draw";
let erasing = false; // dragging the eraser over lines
let ERASER = 14; // radius

let TOOL_HELP = {
  select: "Drag anything to move it: lines, doors, things, frames, pictures and words.",
  text: "Click where the words should go, then type. Click words to change them.",
  image: "Drag a box where the picture should go, then choose a photo.",
  frame: "Drag on the wall to put up a frame for art.",
  path: "Click from point to point. Double-click or press Enter to finish.",
  erase: "Drag over lines to rub them out. Click a door, thing, picture or words to take them away.",
  door: "Click on a line to put a door there.",
};

function setTool(name) {
  if (pathDraft && name != "path") finishPath();
  tool = name;
  placingDoor = name == "door";
  placingFrame = name == "frame" || name == "image";
  if (name != "thing") placingThing = null;
  for (let b of document.querySelectorAll("[data-tool]")) b.classList.toggle("on", b.dataset.tool == name);
  document.getElementById("thingChoice").hidden = name != "thing" || !!placingThing;
  document.getElementById("shapePicker").hidden = true;
  document.body.classList.toggle("erasing", name == "erase");
  document.body.dataset.using = name;
  if (TOOL_HELP[name]) showStatus(TOOL_HELP[name], 5000);
  else if (name != "thing") document.getElementById("status").hidden = true;
  if (name == "shapes") showShapePicker();
  if (name == "scissors") openCutEditor();
}

function hookTools() {
  for (let b of document.querySelectorAll("[data-tool]")) {
    b.onclick = () => setTool(tool == b.dataset.tool && !["draw", "shapes"].includes(b.dataset.tool) ? "draw" : b.dataset.tool);
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
    lines: r.lines.map((l) => seeded(l.map((p) => ({ ...p })), l.seed)),
    doors: [...r.doors],
    things: [...r.things],
    frames: [...r.frames],
    texts: r.texts.map((t) => ({ ...t })),
  };
}

function restoreSnapshot(snap) {
  let r = room();
  r.lines.length = 0;
  r.lines.push(...snap.lines);
  r.doors = snap.doors;
  r.things = snap.things;
  r.frames = snap.frames;
  r.texts = snap.texts || [];
}

function eraseStart(x, y) {
  let before = roomSnapshot();
  let r = room();
  // a door, thing or frame under the eraser goes in one click
  let { w: dw, h: dh } = doorSize();
  let door = [...r.doors].reverse().find((d) => abs(x - d.x) < dw / 2 && y < d.y && y > d.y - dh);
  let thing = [...r.things].reverse().find((t) => {
    let { w, h } = thingSize(t);
    return abs(x - t.x) < w / 2 && y < t.y && y > t.y - h;
  });
  let frame = frameAt(x, y);
  let words = textAt(x, y);
  if (words) r.texts = r.texts.filter((t) => t != words);
  else if (door) r.doors = r.doors.filter((d) => d != door);
  else if (thing) r.things = r.things.filter((t) => t != thing);
  else if (frame) r.frames = r.frames.filter((f) => f != frame);
  if (words || door || thing || frame) {
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
    pieces.forEach((pc, i) => kept.push(seeded(pc, l.seed + i * 17)));
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
  if (tool != "erase" || mapOpen || editingFrame) return;
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
