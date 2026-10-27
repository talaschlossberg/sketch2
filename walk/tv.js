// TV: a set drawn in pen, with a programme playing on its screen. Put one
// down from the Thing list, then click it to change the channel or play
// your own video. Used by sketch.js.

let CHANNELS = {
  static: "Static",
  bars: "Test card",
  walker: "Her walking",
  sky: "The sky",
  video: "Your video",
};
let tvVideos = new WeakMap(); // tv -> { blob, el } once its video is ready
let tuning = null; // the tv whose channel is being changed
let noiseTile = null;

THINGS.tv = {
  label: "TV",
  drawn: true,
  height: 0.62,
  aspect: 1.25,
  tops: [{ y: 0.17, x1: 0.04, x2: 0.96 }], // the top of the set, under the antennas
  icon:
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 56" fill="none" stroke="#1a1714" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2l8 10 10-11"/><rect x="3" y="12" width="54" height="36" rx="5" fill="#fffdf8"/><rect x="8" y="17" width="36" height="26" rx="4" fill="#9db6d6"/><circle cx="51" cy="22" r="2.5"/><circle cx="51" cy="31" r="2.5"/><path d="M12 48l-3 6M48 48l3 6"/></svg>'
    ),
};

// where the screen sits on the set, as shares of its width and height
let SCREEN = { x: 0.1, y: 0.28, w: 0.66, h: 0.56 };

function tvBox(t) {
  let { w, h } = thingSize(t);
  return { x: t.x - w / 2, y: t.y - h, w, h };
}

function screenBox(t) {
  let b = tvBox(t);
  return { x: b.x + SCREEN.x * b.w, y: b.y + SCREEN.y * b.h, w: SCREEN.w * b.w, h: SCREEN.h * b.h };
}

// the set itself, in pen; the screen is filled in live on top
function inkTV(g, t) {
  let b = tvBox(t);
  let s = screenBox(t);
  let top = b.y + b.h * 0.17;
  let bottom = b.y + b.h * 0.9;
  let seed = (t.x * 7) % 1000;
  g.push();
  g.noStroke();
  g.fill(253, 250, 243);
  g.rect(b.x, top, b.w, bottom - top, 10);
  g.fill(18, 22, 26);
  g.rect(s.x, s.y, s.w, s.h, 8);
  g.fill(inkHere());
  let box = (x, y, w, h) => sharp([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y: y - 1 }]);
  inkLine(g, box(b.x, top, b.w, bottom - top), seed);
  inkLine(g, box(s.x - 3, s.y - 3, s.w + 6, s.h + 6), seed + 1);
  // antennas, knobs, a speaker grille, legs
  let mid = b.x + b.w * 0.45;
  inkLine(g, [{ x: mid, y: top }, { x: mid - b.w * 0.16, y: b.y }], seed + 2);
  inkLine(g, [{ x: mid, y: top }, { x: mid + b.w * 0.2, y: b.y + b.h * 0.02 }], seed + 3);
  let knobX = b.x + b.w * 0.88;
  g.circle(knobX, b.y + b.h * 0.38, b.w * 0.07);
  g.circle(knobX, b.y + b.h * 0.55, b.w * 0.07);
  for (let i = 0; i < 3; i++) {
    let y = b.y + b.h * (0.67 + i * 0.06);
    inkLine(g, [{ x: knobX - b.w * 0.04, y }, { x: knobX + b.w * 0.04, y }], seed + 4 + i);
  }
  inkLine(g, [{ x: b.x + b.w * 0.16, y: bottom }, { x: b.x + b.w * 0.1, y: t.y }], seed + 8);
  inkLine(g, [{ x: b.x + b.w * 0.84, y: bottom }, { x: b.x + b.w * 0.9, y: t.y }], seed + 9);
  g.pop();
}

// what's on: drawn every frame onto each set's screen
function drawTVs() {
  for (let t of room().things) {
    if (t.type != "tv") continue;
    let s = screenBox(t);
    push();
    drawingContext.save();
    drawingContext.beginPath();
    drawingContext.roundRect(s.x, s.y, s.w, s.h, 8);
    drawingContext.clip();
    paintChannel(window, t, s);
    glassOver(drawingContext, s);
    drawingContext.restore();
    pop();
  }
}

// the programme on channel t.channel, painted into box s of g (the world, or the big screen)
function paintChannel(g, t, s) {
  let ch = t.channel || "static";
  if (ch == "bars") testCard(g, s);
  else if (ch == "walker") walkerOnTV(g, s);
  else if (ch == "sky") {
    if (!skyLayer || skyLayer.width != width) paintSky();
    g.image(skyLayer, s.x, s.y, s.w, s.h);
    if (cloudLayer && (skyName == "day" || skyName == "sunset")) g.image(cloudLayer, s.x - (cloudDrift / cloudLayer.width) * s.w * 1.5, s.y, s.w * 1.5, s.h);
  } else if (ch == "video" && tvVideo(t)) {
    let v = tvVideo(t);
    g.noStroke();
    g.fill(0);
    g.rect(s.x, s.y, s.w, s.h);
    if (v.readyState >= 2) {
      let k = max(s.w / v.videoWidth, s.h / v.videoHeight);
      g.drawingContext.drawImage(v, s.x + (s.w - v.videoWidth * k) / 2, s.y + (s.h - v.videoHeight * k) / 2, v.videoWidth * k, v.videoHeight * k);
    }
  } else staticOn(g, s);
}

// a little glass: a sheen and dark corners
function glassOver(ctx, s) {
  let glass = ctx.createRadialGradient(s.x + s.w * 0.5, s.y + s.h * 0.45, s.h * 0.2, s.x + s.w * 0.5, s.y + s.h * 0.5, s.w * 0.75);
  glass.addColorStop(0, "rgba(255, 255, 255, 0.06)");
  glass.addColorStop(1, "rgba(0, 0, 0, 0.45)");
  ctx.fillStyle = glass;
  ctx.fillRect(s.x, s.y, s.w, s.h);
}

function staticOn(g, s) {
  if (!noiseTile) noiseTile = createImage(80, 60);
  if (frameCount % 2 == 0 && noiseTile.frame != frameCount) {
    noiseTile.frame = frameCount;
    noiseTile.loadPixels();
    for (let i = 0; i < noiseTile.pixels.length; i += 4) {
      let v = random(255);
      noiseTile.pixels[i] = v;
      noiseTile.pixels[i + 1] = v;
      noiseTile.pixels[i + 2] = v;
      noiseTile.pixels[i + 3] = 255;
    }
    noiseTile.updatePixels();
  }
  g.drawingContext.imageSmoothingEnabled = false;
  g.image(noiseTile, s.x, s.y, s.w, s.h);
  g.drawingContext.imageSmoothingEnabled = true;
}

function testCard(g, s) {
  let bars = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];
  g.noStroke();
  bars.forEach((c, i) => {
    g.fill(c);
    g.rect(s.x + (i * s.w) / 7, s.y, s.w / 7 + 1, s.h * 0.72);
  });
  let low = ["#0000c0", "#131313", "#c000c0", "#131313", "#00c0c0", "#131313", "#c0c0c0"];
  low.forEach((c, i) => {
    g.fill(c);
    g.rect(s.x + (i * s.w) / 7, s.y + s.h * 0.72, s.w / 7 + 1, s.h * 0.1);
  });
  g.fill(18);
  g.rect(s.x, s.y + s.h * 0.82, s.w, s.h * 0.18);
  g.fill(235);
  g.rect(s.x + s.w * 0.1, s.y + s.h * 0.85, s.w * 0.18, s.h * 0.12);
}

// her, on television, walking on the spot in front of a pale studio wall
function walkerOnTV(g, s) {
  g.noStroke();
  g.fill(214, 206, 192);
  g.rect(s.x, s.y, s.w, s.h);
  g.fill(170, 160, 146);
  g.rect(s.x, s.y + s.h * 0.8, s.w, s.h * 0.2);
  if (!walker) return;
  let { imgs, crop } = walker;
  let i = floor(frameCount / 4) % imgs.length;
  let h = s.h * 0.86;
  let w = (crop.w * h) / crop.h;
  g.push();
  g.translate(s.x + s.w / 2, s.y + s.h * 0.94);
  g.scale(drawnFacing, 1);
  g.drawingContext.imageSmoothingEnabled = !walker.pixel;
  g.image(imgs[i], -w / 2, -h, w, h, crop.x, crop.y, crop.w, crop.h);
  g.drawingContext.imageSmoothingEnabled = true;
  g.pop();
}

// ---- watching: walk up to a set and press up ----

let watching = null; // the tv being watched big
let watchScreen = null; // the big screen, a p5 graphics shown in the popup

function tvNear() {
  if (!guy.onGround || trip) return null;
  return room().things.find((t) => {
    if (t.type != "tv") return false;
    let { w } = thingSize(t);
    return abs(guy.x - t.x) < w * 0.45 && abs(guy.y - t.y) < 12;
  }) || null;
}

function drawTVHint() {
  let t = tvNear();
  if (!t || doorNear()) return;
  // above her head or the set, whichever is higher, so she doesn't hide it
  let y = min(tvBox(t).y, guy.y - GUY_HEIGHT) - 14 + sin(frameCount * 0.1) * 3;
  push();
  stroke(inkHere());
  strokeWeight(2.5);
  line(guy.x, y, guy.x, y - 18);
  line(guy.x - 7, y - 11, guy.x, y - 18);
  line(guy.x + 7, y - 11, guy.x, y - 18);
  noStroke();
  fill(inkHere());
  textFont("Comic Neue");
  textStyle(BOLD);
  textSize(14);
  textAlign(CENTER, BOTTOM);
  text("watch", guy.x, y - 22);
  pop();
}

function openWatch(t) {
  watching = t;
  document.getElementById("watch").hidden = false;
  markWatchChannels();
  showOnWatch();
}

function closeWatch() {
  if (!watching) return;
  let v = document.getElementById("watchVideo");
  v.pause();
  v.removeAttribute("src");
  v.load();
  watching = null;
  document.getElementById("watch").hidden = true;
}

// your video plays in a proper player, with sound; other channels are painted live
function showOnWatch() {
  let t = watching;
  let v = document.getElementById("watchVideo");
  let isVideo = t.channel == "video" && t.video;
  v.hidden = !isVideo;
  watchScreen.elt.hidden = isVideo;
  if (isVideo) {
    if (v.dataset.blob != t.video.size + t.video.name) {
      v.src = URL.createObjectURL(t.video);
      v.dataset.blob = t.video.size + t.video.name;
    }
    v.muted = false;
    v.play().catch(() => {});
    let small = tvVideo(t);
    if (small) small.muted = true; // one sound at a time
  } else {
    v.pause();
  }
  document.getElementById("watchTitle").textContent = CHANNELS[t.channel || "static"];
}

function drawWatch() {
  if (!watching || !watchScreen || watchScreen.elt.hidden) return;
  let s = { x: 0, y: 0, w: watchScreen.width, h: watchScreen.height };
  watchScreen.push();
  paintChannel(watchScreen, watching, s);
  glassOver(watchScreen.drawingContext, s);
  watchScreen.pop();
}

function markWatchChannels() {
  for (let b of document.querySelectorAll("#watchChannels [data-channel]")) b.classList.toggle("on", (watching.channel || "static") == b.dataset.channel);
  document.getElementById("watchPickVideo").textContent = watching.video ? "Replace video" : "Choose a video";
}

function hookWatch() {
  watchScreen = createGraphics(640, 480);
  watchScreen.elt.style.display = "";
  // p5 fixes the canvas at 640 by 480 on the page; let it fill the player instead
  watchScreen.elt.style.width = "100%";
  watchScreen.elt.style.height = "100%";
  watchScreen.elt.id = "watchCanvas";
  document.getElementById("watchScreen").appendChild(watchScreen.elt);
  let list = document.getElementById("watchChannels");
  for (let ch in CHANNELS) {
    let b = document.createElement("button");
    b.dataset.channel = ch;
    b.textContent = CHANNELS[ch];
    b.onclick = () => {
      if (ch == "video" && !watching.video) {
        tuning = watching;
        return document.getElementById("tvVideoInput").click();
      }
      watching.channel = ch;
      markWatchChannels();
      showOnWatch();
      saveWorld();
    };
    list.appendChild(b);
  }
  document.getElementById("watchClose").onclick = closeWatch;
  document.getElementById("watchPickVideo").onclick = () => {
    tuning = watching;
    document.getElementById("tvVideoInput").click();
  };
  document.getElementById("watch").onclick = (e) => {
    if (e.target.id == "watch") closeWatch(); // a click outside the set closes it
  };
}

function tvVideo(t) {
  if (!t.video) return null;
  let known = tvVideos.get(t);
  if (known && known.blob == t.video) return known.el;
  let el = document.createElement("video");
  el.muted = !t.sound;
  el.loop = true;
  el.playsInline = true;
  el.src = URL.createObjectURL(t.video);
  el.play().catch(() => {});
  tvVideos.set(t, { blob: t.video, el });
  return el;
}

function tvAt(x, y) {
  return [...room().things].reverse().find((t) => {
    if (t.type != "tv") return false;
    let b = tvBox(t);
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  });
}

// ---- changing the channel ----

function openTuner(t) {
  tuning = t;
  markChannels();
  document.getElementById("tvPanel").hidden = false;
}

function closeTuner() {
  tuning = null;
  document.getElementById("tvPanel").hidden = true;
}

function markChannels() {
  for (let b of document.querySelectorAll("#tvChannels [data-channel]")) b.classList.toggle("on", (tuning.channel || "static") == b.dataset.channel);
  document.getElementById("tvSound").textContent = tuning.sound ? "Sound: on" : "Sound: off";
  document.getElementById("tvSound").classList.toggle("on", !!tuning.sound);
}

function hookTV() {
  let list = document.getElementById("tvChannels");
  for (let ch in CHANNELS) {
    let b = document.createElement("button");
    b.dataset.channel = ch;
    b.textContent = CHANNELS[ch];
    b.onclick = () => {
      if (ch == "video" && !tuning.video) return document.getElementById("tvVideoInput").click();
      tuning.channel = ch;
      markChannels();
      saveWorld();
    };
    list.appendChild(b);
  }
  let input = document.getElementById("tvVideoInput");
  document.getElementById("tvPickVideo").onclick = () => input.click();
  input.onchange = () => {
    let file = input.files[0];
    input.value = "";
    if (!file || !tuning) return;
    tuning.video = file;
    tuning.channel = "video";
    let v = tvVideo(tuning);
    v.onerror = () => showStatus("That video won't play here. Try an MP4 or MOV.", 5000);
    if (watching == tuning) {
      markWatchChannels();
      showOnWatch();
    } else markChannels();
    saveWorld();
  };
  document.getElementById("tvSound").onclick = () => {
    tuning.sound = !tuning.sound;
    let v = tvVideo(tuning);
    if (v) {
      v.muted = !tuning.sound;
      v.play().catch(() => {});
    }
    markChannels();
    saveWorld();
  };
  document.getElementById("tvDone").onclick = closeTuner;
}
