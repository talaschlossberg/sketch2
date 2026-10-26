// Things: real objects cut from film photos, standing on the lines like doors.
// She walks past them, or jumps up onto their tops. Used by sketch.js.

// height is a share of her height; tops are surfaces she can stand on,
// as shares of the picture (y down from its top, x1 to x2 across it)
let THINGS = {
  oven: {
    label: "Oven",
    file: "things/oven.png",
    height: 0.75,
    tops: [
      { y: 0.278, x1: 0.01, x2: 0.99 }, // the cooktop
      { y: 0.0, x1: 0.19, x2: 0.97 }, // the top of the back panel, with the clock
    ],
  },
};

let thingPictures = {};
let placingThing = null;

function thingUrl(name) {
  return THINGS[name].art || THINGS[name].file;
}

function loadThings() {
  for (let name in THINGS) {
    urlToImage(thingUrl(name)).then((el) => {
      let img = createImage(el.naturalWidth, el.naturalHeight);
      img.drawingContext.drawImage(el, 0, 0);
      thingPictures[name] = img;
      for (let r of rooms) r.ink = null;
      inkDirty = true;
    }, () => {});
  }
}

function thingSize(t) {
  let pic = thingPictures[t.type];
  let h = GUY_HEIGHT * THINGS[t.type].height;
  let w = pic ? (h * pic.width) / pic.height : h * 0.84;
  return { w, h };
}

function inkThing(g, t) {
  let pic = thingPictures[t.type];
  if (!pic) return;
  let { w, h } = thingSize(t);
  g.image(pic, t.x - w / 2, t.y - h, w, h);
}

// surfaces on the things in this room, for her to land on
function thingTops() {
  let out = [];
  for (let t of room().things || []) {
    let { w, h } = thingSize(t);
    let left = t.x - w / 2;
    for (let top of THINGS[t.type].tops) {
      let y = t.y - h + top.y * h;
      out.push(platform([{ x: left + top.x1 * w, y }, { x: left + top.x2 * w, y }]));
    }
  }
  return out;
}

function placeThing(x, y) {
  let base = groundBelow(x, y - 30);
  if (base == null) base = floorY();
  room().things.push({ type: placingThing, x, y: base });
  room().history.push("thing");
  inkDirty = true;
  setPlacingThing(null);
  saveWorld();
}

function setPlacingThing(name) {
  if (!name) return setTool("draw");
  setTool("thing");
  placingThing = name;
  document.getElementById("thingChoice").hidden = true;
  showStatus("Click on a line to put the " + THINGS[name].label.toLowerCase() + " there.");
}

function hookThings() {
  fillThingChoices();
  document.getElementById("noThing").onclick = () => setPlacingThing(null);
}

// one button per thing, your own cutouts included
function fillThingChoices() {
  let list = document.querySelector("#thingChoice .choices");
  list.innerHTML = "";
  for (let name in THINGS) {
    let b = document.createElement("button");
    b.className = "thing-pick";
    let img = document.createElement("img");
    img.src = thingUrl(name);
    img.alt = "";
    b.append(img, THINGS[name].label);
    b.onclick = () => setPlacingThing(name);
    list.appendChild(b);
  }
}
