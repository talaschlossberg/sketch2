// Fill: click inside a shape made of lines and it fills with colour, like
// gouache under the ink. The lines, the floor, doors and photos all count
// as edges; a space that isn't closed in can't be filled. Used by sketch.js.

let FILL_COLOURS = ["#c1442a", "#e2a33a", "#e7a2a8", "#7fa7c9", "#2f5d8a", "#6f8f4e", "#f3ead8", "#8a877e", "#1a1916"];
let fillColour = FILL_COLOURS[0];
let FILL_SCALE = 0.5; // the edges are traced at half size, which is plenty and quick

// the edges, drawn into a plain canvas: 1 where there's an edge
function edgeMask() {
  let w = ceil(width * FILL_SCALE);
  let h = ceil(height * FILL_SCALE);
  let c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  let ctx = c.getContext("2d");
  ctx.scale(FILL_SCALE, FILL_SCALE);
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#000";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let l of [...solidLines(), ...roomDrawing(), ...lines]) {
    ctx.beginPath();
    ctx.moveTo(l[0].x, l[0].y);
    for (let p of l) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  for (let d of room().doors) {
    let { w: dw, h: dh } = doorSize(d);
    ctx.fillRect(d.x - dw / 2, d.y - dh, dw, dh);
  }
  for (let f of room().images) ctx.fillRect(f.x, f.y, f.w, f.h);
  let data = ctx.getImageData(0, 0, w, h).data;
  let mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] > 40 ? 1 : 0;
  // small gaps in hand-drawn lines shouldn't let the colour leak out
  return { mask: grow(mask, w, h, 1), w, h };
}

function fillAt(x, y) {
  let { mask, w, h } = edgeMask();
  let sx = floor(x * FILL_SCALE);
  let sy = floor(y * FILL_SCALE);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || mask[sy * w + sx]) return;

  // flood out from the click until the edges stop it
  let inside = new Uint8Array(w * h);
  let stack = [sy * w + sx];
  let open = false;
  while (stack.length) {
    let i = stack.pop();
    if (inside[i] || mask[i]) continue;
    inside[i] = 1;
    let px = i % w;
    let py = (i - px) / w;
    if (px == 0 || py == 0 || px == w - 1 || py == h - 1) open = true;
    if (px > 0) stack.push(i - 1);
    if (px < w - 1) stack.push(i + 1);
    if (py > 0) stack.push(i - w);
    if (py < h - 1) stack.push(i + w);
  }
  if (open) {
    showStatus("That space isn't closed in. Close the shape with lines, then fill it.", 4000);
    return;
  }

  // the colour slides a little under the lines, so there's no gap at the edge
  inside = grow(inside, w, h, 2);
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let i = 0; i < w * h; i++) {
    if (!inside[i]) continue;
    let px = i % w;
    let py = (i - px) / w;
    x0 = min(x0, px);
    x1 = max(x1, px);
    y0 = min(y0, py);
    y1 = max(y1, py);
  }
  let bw = x1 - x0 + 1;
  let bh = y1 - y0 + 1;
  let c = document.createElement("canvas");
  c.width = bw;
  c.height = bh;
  let ctx = c.getContext("2d");
  let img = ctx.createImageData(bw, bh);
  let [r, g, b] = [1, 3, 5].map((k) => parseInt(fillColour.slice(k, k + 2), 16));
  for (let py = 0; py < bh; py++) {
    for (let px = 0; px < bw; px++) {
      if (!inside[(py + y0) * w + px + x0]) continue;
      let o = (py * bw + px) * 4;
      // a little unevenness, like paint brushed on
      let n = noise((px + x0) * 0.08, (py + y0) * 0.08) * 0.22 + random(0.06);
      img.data[o] = r * (0.92 + n * 0.4);
      img.data[o + 1] = g * (0.92 + n * 0.4);
      img.data[o + 2] = b * (0.92 + n * 0.4);
      img.data[o + 3] = 236;
    }
  }
  ctx.putImageData(img, 0, 0);

  pushUndo();
  // filling a shape that's already filled changes its colour
  room().fills = room().fills.filter((f) => !fillCovers(f, x, y));
  room().fills.push({ x: x0 / FILL_SCALE, y: y0 / FILL_SCALE, w: bw / FILL_SCALE, h: bh / FILL_SCALE, art: c.toDataURL("image/png"), colour: fillColour });
  inkDirty = true;
  saveWorld();
}

// is (x, y) painted by this fill?
function fillCovers(f, x, y) {
  if (x < f.x || y < f.y || x > f.x + f.w || y > f.y + f.h) return false;
  let pic = pictureOf(f.art);
  if (!pic) return true;
  let px = floor(((x - f.x) / f.w) * pic.width);
  let py = floor(((y - f.y) / f.h) * pic.height);
  return pic.drawingContext.getImageData(px, py, 1, 1).data[3] > 0;
}

function fillAtPoint(x, y) {
  return [...room().fills].reverse().find((f) => fillCovers(f, x, y));
}

function inkFill(g, f) {
  let pic = pictureOf(f.art);
  if (pic) g.image(pic, f.x, f.y, f.w, f.h);
}

function hookFill() {
  let picker = document.getElementById("fillPicker");
  for (let c of FILL_COLOURS) {
    let b = document.createElement("button");
    b.className = "swatch";
    b.style.setProperty("--swatch", c);
    b.dataset.colour = c;
    b.setAttribute("aria-label", "Fill colour " + c);
    b.onclick = () => {
      fillColour = c;
      markFillColour();
      picker.hidden = true;
    };
    picker.appendChild(b);
  }
  markFillColour();
}

function markFillColour() {
  for (let b of document.querySelectorAll("#fillPicker .swatch")) b.classList.toggle("on", b.dataset.colour == fillColour);
  document.documentElement.style.setProperty("--fill", fillColour);
}

function showFillPicker() {
  let picker = document.getElementById("fillPicker");
  let r = document.querySelector('[data-tool="fill"]').getBoundingClientRect();
  picker.style.top = r.top + "px";
  picker.hidden = false;
}
