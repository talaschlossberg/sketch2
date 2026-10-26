// Map: every room as a card, with a line for each door between them.
// Drag cards to arrange them, click one to go there, click a name to rename
// it, and link doors to rooms. Used by sketch.js.

let mapOpen = false;
let linkingDoor = null; // a door waiting for you to click the room it leads to

function toggleMap() {
  if (mapOpen) closeMap();
  else openMap();
}

function openMap(door = null) {
  snapshotRoom();
  if (placingDoor) setPlacingDoor(false);
  linkingDoor = door;
  mapOpen = true;
  document.getElementById("map").hidden = false;
  renderMap();
}

function closeMap() {
  mapOpen = false;
  linkingDoor = null;
  document.getElementById("map").hidden = true;
}

function renderMap() {
  let board = document.getElementById("mapBoard");
  board.querySelectorAll(".card").forEach((c) => c.remove());
  document.getElementById("mapHint").textContent = linkingDoor
    ? "Click the room this door should lead to, or make a new one."
    : "Drag rooms to arrange them. Click one to go there. Click a name to rename it.";
  board.classList.toggle("linking", !!linkingDoor);

  for (let r of rooms) board.appendChild(makeCard(r));
  sizeBoard();
  drawLinks();
}

function makeCard(r) {
  let card = document.createElement("div");
  card.className = "card " + r.kind + (r == room() ? " here" : "");
  card.style.left = r.map.x + "px";
  card.style.top = r.map.y + "px";
  card.dataset.id = r.id;

  let pic = document.createElement("div");
  pic.className = "pic";
  if (r.thumb) pic.style.backgroundImage = "url(" + r.thumb + ")";
  else pic.textContent = "Not visited yet";
  card.appendChild(pic);

  let name = document.createElement("span");
  name.className = "name";
  name.contentEditable = "true";
  name.spellcheck = false;
  name.textContent = r.name;
  name.onpointerdown = (e) => e.stopPropagation();
  name.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key == "Enter") {
      e.preventDefault();
      name.blur();
    }
  };
  name.onblur = () => {
    r.name = name.textContent.trim() || r.name;
    name.textContent = r.name;
    saveWorld();
  };
  card.appendChild(name);

  let info = document.createElement("div");
  info.className = "info";
  let kind = KIND_NAMES[r.kind];
  let doorCount = r.doors.length == 1 ? "1 door" : r.doors.length + " doors";
  info.textContent = r == room() ? kind + " · " + doorCount + " · she's here" : kind + " · " + doorCount;
  card.appendChild(info);

  let loose = r.doors.filter((d) => !d.to || !roomById(d.to));
  if (loose.length && !linkingDoor) {
    let link = document.createElement("button");
    link.className = "small";
    link.textContent = loose.length == 1 ? "Link its door" : "Link a door (" + loose.length + " to go)";
    link.onpointerdown = (e) => e.stopPropagation();
    link.onclick = () => {
      linkingDoor = loose[0];
      renderMap();
    };
    card.appendChild(link);
  }

  if (rooms.length > 1 && r != room()) {
    let del = document.createElement("button");
    del.className = "delete";
    del.title = "Delete " + r.name;
    del.setAttribute("aria-label", "Delete " + r.name);
    del.textContent = "×";
    del.onpointerdown = (e) => e.stopPropagation();
    del.onclick = () => deleteRoom(r, del);
    card.appendChild(del);
  }

  dragCard(card, r);
  return card;
}

// drag to move; a press that doesn't move is a click
function dragCard(card, r) {
  card.onpointerdown = (e) => {
    if (e.button != 0) return;
    card.setPointerCapture(e.pointerId);
    let start = { x: e.clientX, y: e.clientY, mx: r.map.x, my: r.map.y };
    let moved = false;
    card.onpointermove = (m) => {
      let dx = m.clientX - start.x;
      let dy = m.clientY - start.y;
      if (abs(dx) + abs(dy) > 5) moved = true;
      if (!moved) return;
      r.map.x = max(0, start.mx + dx);
      r.map.y = max(0, start.my + dy);
      card.style.left = r.map.x + "px";
      card.style.top = r.map.y + "px";
      card.classList.add("dragging");
      drawLinks();
    };
    card.onpointerup = () => {
      card.onpointermove = null;
      card.onpointerup = null;
      card.classList.remove("dragging");
      if (moved) {
        sizeBoard();
        saveWorld();
      } else cardClicked(r);
    };
  };
}

function cardClicked(r) {
  if (linkingDoor) {
    linkDoor(linkingDoor, r);
    linkingDoor = null;
    pendingDoor = null;
    saveWorld();
    renderMap();
    showStatus("That door now leads to " + r.name + ".", 3000);
    return;
  }
  if (r != room()) enterRoom(rooms.indexOf(r), null);
  closeMap();
}

// a second press confirms, so a stray click doesn't lose a room
function deleteRoom(r, button) {
  if (!button.classList.contains("confirm")) {
    button.classList.add("confirm");
    button.textContent = "Delete?";
    setTimeout(() => {
      button.classList.remove("confirm");
      button.textContent = "×";
    }, 2500);
    return;
  }
  let here = room();
  rooms = rooms.filter((x) => x != r);
  for (let other of rooms) for (let d of other.doors) if (d.to == r.id) d.to = null;
  roomIndex = rooms.indexOf(here);
  inkDirty = true;
  saveWorld();
  renderMap();
}

function newRoomFromMap(kind) {
  let home = linkingDoor && rooms.find((x) => x.doors.includes(linkingDoor));
  let spot = home ? freeMapSpot(home.map.x + 280, home.map.y) : freeMapSpot(40, 160);
  let r = makeRoom(kind, null, spot);
  if (linkingDoor) {
    linkDoor(linkingDoor, r);
    linkingDoor = null;
    pendingDoor = null;
  }
  saveWorld();
  renderMap();
}

function sizeBoard() {
  let board = document.getElementById("mapBoard");
  let w = max(...rooms.map((r) => r.map.x)) + 260;
  let h = max(...rooms.map((r) => r.map.y)) + 240;
  let svg = document.getElementById("mapLinks");
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  board.style.setProperty("--board-w", w + "px");
  board.style.setProperty("--board-h", h + "px");
}

// one line per pair of linked rooms; dashed when the door only goes one way
function drawLinks() {
  let svg = document.getElementById("mapLinks");
  svg.innerHTML = "";
  let centre = (r) => {
    let card = document.querySelector('.card[data-id="' + r.id + '"]');
    return { x: r.map.x + card.offsetWidth / 2, y: r.map.y + card.offsetHeight / 2 };
  };
  let seen = new Set();
  for (let a of rooms) {
    for (let d of a.doors) {
      let b = roomById(d.to);
      if (!b || b == a) continue;
      let key = [a.id, b.id].sort().join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      let both = b.doors.some((x) => x.to == a.id);
      let p = centre(a);
      let q = centre(b);
      // bowed, so a link between far-apart rooms arcs over the cards between them
      let len = dist(p.x, p.y, q.x, q.y);
      let bow = len < 320 ? 0.18 * len : min(0.6 * len, 700); // neighbours gently, far ones well clear
      let c = { x: (p.x + q.x) / 2 + ((q.y - p.y) / len) * bow, y: (p.y + q.y) / 2 - ((q.x - p.x) / len) * bow };
      if (c.y > (p.y + q.y) / 2) c = { x: p.x + q.x - c.x, y: p.y + q.y - c.y }; // always bow upwards
      let path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${p.x} ${p.y} Q ${c.x} ${c.y} ${q.x} ${q.y}`);
      if (!both) path.setAttribute("stroke-dasharray", "8 7");
      svg.appendChild(path);

      // a little door halfway along
      let mid = { x: (p.x + 2 * c.x + q.x) / 4, y: (p.y + 2 * c.y + q.y) / 4 };
      let door = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      door.setAttribute("x", mid.x - 7);
      door.setAttribute("y", mid.y - 11);
      door.setAttribute("width", 14);
      door.setAttribute("height", 22);
      door.setAttribute("rx", 1.5);
      svg.appendChild(door);
    }
  }
}

function hookMap() {
  document.getElementById("closeMap").onclick = closeMap;
  for (let b of document.querySelectorAll("#mapBar [data-new]")) b.onclick = () => newRoomFromMap(b.dataset.new);
  document.addEventListener("keydown", (e) => {
    if (e.key != "Escape") return;
    if (mapOpen) closeMap();
    closeDoorChoice();
  });
}
