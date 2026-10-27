// Dressing: each new person is her frames recoloured, a different shirt, trousers, hair or skin,
// so the line-up reads as different people. The first one is her as filmed.

let SHIRTS = [
  null, // her own maroon
  { h: 42, s: 0.55, l: 0.42 }, // mustard
  { h: 145, s: 0.28, l: 0.22 }, // forest
  { h: 218, s: 0.42, l: 0.24 }, // navy
  { h: 16, s: 0.55, l: 0.33 }, // rust
  { h: 205, s: 0.1, l: 0.36 }, // slate
  { h: 205, s: 0.38, l: 0.46 }, // sky
  { h: 182, s: 0.38, l: 0.27 }, // teal
  { h: 290, s: 0.22, l: 0.22 }, // plum
  { h: 4, s: 0.62, l: 0.36 }, // red
];
let TROUSERS = [
  null, // her own black
  { h: 214, s: 0.32, k: 2.8 }, // denim
  { h: 38, s: 0.26, k: 5 }, // khaki
  { h: 24, s: 0.35, k: 2.6 }, // brown
  { h: 0, s: 0, k: 3.2 }, // grey
  { h: 70, s: 0.2, k: 2.8 }, // olive
];
let HAIR = [
  null, // her own brown
  { h: 20, s: 0.08, k: 0.55 }, // black
  { h: 12, s: 0.55, k: 1.7 }, // auburn
  { h: 40, s: 0.45, k: 3.4 }, // fair
  { h: 30, s: 0.04, k: 3.6 }, // grey
  { h: 24, s: 0.45, k: 1.3 }, // chestnut
];
let SKIN = [1, 0.8, 0.6, 0.45, 1.08, 0.7]; // lightness, from hers

// the n-th person's clothes; the same every time, so a rehearsal plays out like the take
function lookFor(n) {
  if (n == 0) return { shirt: null, trousers: null, hair: null, skin: 1 };
  let r = seededRandom(n * 7919 + 13);
  let pick = (list, notFirst) => list[notFirst ? 1 + floor(r() * (list.length - 1)) : floor(r() * list.length)];
  let shirt = SHIRTS[1 + ((n - 1) % (SHIRTS.length - 1))]; // shirts go round, so neighbours never match
  return { shirt, trousers: pick(TROUSERS), hair: pick(HAIR), skin: pick(SKIN) };
}

function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// a set of canvases, one per frame, with the look painted in
function dress(frames, look) {
  let { crop } = frames;
  return frames.imgs.map((img) => {
    let c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    let g = c.getContext("2d");
    g.drawImage(img.canvas, 0, 0);
    if (!look.shirt && !look.trousers && !look.hair && look.skin == 1) return c;

    let data = g.getImageData(crop.x, crop.y, crop.w, crop.h);
    let p = data.data;
    let hsl = [0, 0, 0];
    for (let y = 0; y < crop.h; y++) {
      let down = y / crop.h; // 0 at the top of her head, 1 at her feet
      for (let x = 0; x < crop.w; x++) {
        let i = (y * crop.w + x) * 4;
        if (p[i + 3] < 10) continue;
        toHsl(p[i], p[i + 1], p[i + 2], hsl);
        let [h, s, l] = hsl;
        let reddish = h < 50 || h > 320;

        if (s > 0.12 && ((l > 0.3 && h >= 8 && h < 50) || (l > 0.45 && reddish))) {
          // skin (the shirt's highlights are as light, but pinker)
          if (look.skin == 1) continue;
          l *= look.skin;
          if (look.skin < 1) s = Math.min(1, s * (1 + (1 - look.skin) * 0.4));
        } else if (l > 0.7) {
          continue; // her white socks
        } else if (down < 0.17 || (down < 0.32 && h >= 8 && h < 50)) {
          // hair: all of the head, and the brown (not the maroon of the shirt) that falls over her shoulders
          if (!look.hair) continue;
          l = Math.min(0.85, l * look.hair.k);
          h = look.hair.h;
          s = look.hair.s;
        } else if (down < 0.5 && reddish && s > 0.04) {
          // shirt
          if (!look.shirt) continue;
          l = constrain(look.shirt.l + (l - 0.16) * 1.1, 0.02, 0.95); // her folds and shading, around the new colour
          h = look.shirt.h;
          s = look.shirt.s;
        } else if (down > 0.38 && down < 0.9) {
          // trousers (the shoes below stay black)
          if (!look.trousers) continue;
          l = Math.min(0.85, l * look.trousers.k);
          h = look.trousers.h;
          s = look.trousers.s;
        } else continue;

        toRgb(h, s, l, p, i);
      }
    }
    g.putImageData(data, crop.x, crop.y);
    return c;
  });
}

// h in degrees, s and l from 0 to 1
function toHsl(r, g, b, out) {
  r /= 255;
  g /= 255;
  b /= 255;
  let hi = Math.max(r, g, b);
  let lo = Math.min(r, g, b);
  let l = (hi + lo) / 2;
  let h = 0;
  let s = 0;
  if (hi != lo) {
    let d = hi - lo;
    s = l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo);
    if (hi == r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (hi == g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  out[0] = h;
  out[1] = s;
  out[2] = l;
}

function toRgb(h, s, l, p, i) {
  let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  let m = 2 * l - q;
  let part = (t) => {
    t = (((t % 360) + 360) % 360) / 360;
    if (t < 1 / 6) return m + (q - m) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return m + (q - m) * (2 / 3 - t) * 6;
    return m;
  };
  p[i] = part(h + 120) * 255;
  p[i + 1] = part(h) * 255;
  p[i + 2] = part(h - 120) * 255;
}
