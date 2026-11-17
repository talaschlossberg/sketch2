// Pictures: loading a picture once and drawing it. Floors of your own photo use it,
// and so do photos and fills that older worlds hold. Used by sketch.js.

let pictures = new Map(); // picture data -> p5 image, once loaded

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

// a photo or a fill: a picture in a box
function inkImage(g, f) {
  let pic = pictureOf(f.art);
  if (pic) g.image(pic, f.x, f.y, f.w, f.h);
}
