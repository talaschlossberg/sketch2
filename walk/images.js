// Images: photos placed straight into the world. Drag a box, pick a photo,
// and it takes the photo's shape inside that box. Used by sketch.js.

let imageDraft = null; // the box being dragged out: { x0, y0, x1, y1 }
let pendingImage = null; // an image waiting for its photo
let pictures = new Map(); // picture data -> p5 image, once loaded (images and fills)

// the p5 image for some picture data; loads it the first time and redraws when it's ready
function pictureOf(src) {
  if (!src) return null;
  if (pictures.has(src)) return pictures.get(src);
  pictures.set(src, null);
  urlToImage(src).then((el) => {
    let img = createImage(el.naturalWidth, el.naturalHeight);
    img.drawingContext.drawImage(el, 0, 0);
    pictures.set(src, img);
    for (let r of rooms) r.ink = null;
    inkDirty = true;
    worldKey = ""; // a floor photo may have been waiting for it
  }, () => {});
  return null;
}

function inkImage(g, f) {
  let pic = pictureOf(f.art);
  if (pic) return g.image(pic, f.x, f.y, f.w, f.h);
  if (f.art) return; // still loading
  g.push();
  g.noFill();
  g.stroke(inkHere());
  g.strokeWeight(1.5);
  g.drawingContext.setLineDash([6, 5]);
  g.rect(f.x, f.y, f.w, f.h);
  g.drawingContext.setLineDash([]);
  g.noStroke();
  g.fill(inkHere());
  g.textFont(MONO);
  g.textAlign(CENTER, CENTER);
  g.textSize(12);
  g.text("click to add a photo", f.x + f.w / 2, f.y + f.h / 2);
  g.pop();
}

function imageAt(x, y) {
  return [...room().images].reverse().find((f) => x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h);
}

function startImage(x, y) {
  imageDraft = { x0: x, y0: y, x1: x, y1: y };
}

function drawImageDraft() {
  if (!imageDraft) return;
  let d = imageDraft;
  push();
  noFill();
  stroke(inkHere());
  strokeWeight(2);
  drawingContext.setLineDash([8, 6]);
  rect(min(d.x0, d.x1), min(d.y0, d.y1), abs(d.x1 - d.x0), abs(d.y1 - d.y0));
  drawingContext.setLineDash([]);
  pop();
}

// a click without a drag makes a box of a usual size; the photo picker opens straight away
function finishImage() {
  let d = imageDraft;
  imageDraft = null;
  let w = abs(d.x1 - d.x0);
  let h = abs(d.y1 - d.y0);
  let f = w > 24 && h > 24 ? { x: min(d.x0, d.x1), y: min(d.y0, d.y1), w, h } : { x: d.x0 - 90, y: d.y0 - 60, w: 180, h: 120 };
  f.art = null;
  pushUndo();
  room().images.push(f);
  inkDirty = true;
  saveWorld();
  choosePhotoFor(f);
}

function choosePhotoFor(f) {
  pendingImage = f;
  document.getElementById("imageInput").click();
}

// the photo keeps its proportions, fitted inside the box that was drawn
function fillImage(f, file) {
  fileToImage(file).then((el) => {
    let s = min(f.w / el.naturalWidth, f.h / el.naturalHeight);
    let w = el.naturalWidth * s;
    let h = el.naturalHeight * s;
    f.x += (f.w - w) / 2;
    f.y += (f.h - h) / 2;
    f.w = w;
    f.h = h;
    let c = document.createElement("canvas");
    let k = min(1, 900 / max(el.naturalWidth, el.naturalHeight));
    c.width = round(el.naturalWidth * k);
    c.height = round(el.naturalHeight * k);
    c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);
    f.art = c.toDataURL("image/jpeg", 0.88);
    inkDirty = true;
    saveWorld();
  }, () => showStatus("Couldn't open that picture. Try a JPG or PNG.", 4000));
}

function hookImages() {
  let input = document.getElementById("imageInput");
  input.onchange = () => {
    let file = input.files[0];
    input.value = "";
    if (file && pendingImage) fillImage(pendingImage, file);
    pendingImage = null;
  };
}

// ---- add-ons: ready-made things to put in the world ----

// each one is a picture standing on the ground; `door` is the part of it she goes in by
// (fractions of the picture), and placing it asks where that door goes
const ADDONS = {
  house: { label: "House", aspect: 900 / 709, door: { x0: 0.277, x1: 0.349, y0: 0.714, y1: 0.982 } },
};
let addonName = "house";

function addonUrl(name) {
  if (name == "house") return houseUrl();
}

function houseUrl() {
  return "things/house.webp";
}

// stands on whatever is under the click, as tall as fits the window
function placeAddon(x, y) {
  let a = ADDONS[addonName];
  let base = groundBelow(x, y - 30);
  if (base == null || base > floorY()) base = floorY();
  let h = round(min(height * 0.8, GUY_HEIGHT * 3.4));
  let w = round(h * a.aspect);
  let f = { x: round(x - w / 2), y: base - h, w, h, art: addonUrl(addonName), addon: addonName, hot: { ...a.door }, portal: true, to: null };
  pushUndo();
  room().images.push(f);
  inkDirty = true;
  saveWorld();
  setTool("select");
  selected = { item: f, kind: "image" };
  pendingDoor = f;
  askWhereDoorGoes("Where does the " + a.label.toLowerCase() + "'s door go?");
}

function showAddonPicker() {
  let picker = document.getElementById("addonPicker");
  if (!picker.children.length) {
    for (let [name, a] of Object.entries(ADDONS)) {
      let b = document.createElement("button");
      b.dataset.addon = name;
      b.title = a.label;
      let img = document.createElement("img");
      img.src = addonUrl(name);
      img.alt = "";
      let cap = document.createElement("span");
      cap.textContent = a.label;
      b.append(img, cap);
      b.onclick = () => {
        addonName = name;
        for (let x of picker.children) x.classList.toggle("on", x == b);
      };
      picker.appendChild(b);
    }
  }
  for (let x of picker.children) x.classList.toggle("on", x.dataset.addon == addonName);
  let r = document.querySelector('[data-tool="addon"]').getBoundingClientRect();
  picker.style.top = r.top + "px";
  picker.hidden = false;
}
