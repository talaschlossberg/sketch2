// Tools: the pen and the door on the rail, and what Undo puts back.
// Used by sketch.js.

let tool = "draw";

let TOOL_HELP = {
  door: "Click on a line to put a door there.",
};

function setTool(name) {
  tool = name;
  placingDoor = name == "door";
  for (let b of document.querySelectorAll("[data-tool]")) b.classList.toggle("on", b.dataset.tool == name);
  document.body.dataset.using = name;
  if (TOOL_HELP[name]) showStatus(TOOL_HELP[name], 5000, "tool-" + name);
  else document.getElementById("status").hidden = true;
}

function hookTools() {
  for (let b of document.querySelectorAll("[data-tool]")) {
    b.onclick = () => setTool(tool == b.dataset.tool ? "draw" : b.dataset.tool);
  }
  document.getElementById("help").onclick = () => {
    let hint = document.getElementById("hint");
    hint.hidden = !hint.hidden;
  };
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

// ---- undo ----

function pushUndo() {
  room().history.push({ snapshot: roomSnapshot() });
}

// what's in the room now, so Undo can put back whatever Clear takes
function roomSnapshot() {
  let r = room();
  return {
    lines: r.lines.map((l) => likeLine(l.map((p) => ({ ...p })), l)),
    doors: r.doors.map((d) => ({ ...d })),
    images: [...r.images],
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

// new points with the same look as line l: its wobble, sharp corners and colour
function likeLine(pts, l, seed = l.seed) {
  seeded(pts, seed);
  if (l.sharp) pts.sharp = true;
  if (l.colour) pts.colour = l.colour;
  return pts;
}
