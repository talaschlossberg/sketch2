"""Make the boiling frames of the alt title from one still (source.png).

Each frame bends the lettering by a different smooth random field, a coarse one
that nudges whole strokes and a fine one that roughens the edges, so played in a
loop the letters wiggle like redrawn line.

    python3 opening/title2/make_wiggle.py
"""

import pathlib

import numpy as np
from PIL import Image

FRAMES = 8
here = pathlib.Path(__file__).parent
rng = np.random.default_rng(3)

src = Image.open(here / "source.png").convert("RGBA")
rgba = np.asarray(src).astype(np.float32) / 255
ink = (1 - rgba[..., :3].mean(axis=2)) * rgba[..., 3]  # dark and opaque is ink
h, w = ink.shape


def field(cell, amount):
    """a smooth random displacement, about `cell` pixels between bumps"""
    small = rng.standard_normal((h // cell + 3, w // cell + 3)).astype(np.float32)
    img = Image.fromarray(small, mode="F").resize((w + 3 * cell, h + 3 * cell), Image.BICUBIC)
    return np.asarray(img)[cell : cell + h, cell : cell + w] * amount


def sample(img, x, y):
    x = np.clip(x, 0, w - 1.001)
    y = np.clip(y, 0, h - 1.001)
    x0 = x.astype(int)
    y0 = y.astype(int)
    fx = x - x0
    fy = y - y0
    top = img[y0, x0] * (1 - fx) + img[y0, x0 + 1] * fx
    bottom = img[y0 + 1, x0] * (1 - fx) + img[y0 + 1, x0 + 1] * fx
    return top * (1 - fy) + bottom * fy


ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
frames = []
for n in range(FRAMES):
    dx = field(70, 2.8) + field(14, 1.1)
    dy = field(70, 2.8) + field(14, 1.1)
    a = sample(ink, xs + dx, ys + dy)
    a = np.clip((a - 0.1) / 0.8, 0, 1)  # crisp edges, like a pen
    frames.append((a * 255).astype(np.uint8))

box = Image.fromarray(np.maximum.reduce(frames)).getbbox()
box = (max(0, box[0] - 8), max(0, box[1] - 8), min(w, box[2] + 8), min(h, box[3] + 8))
for n, a in enumerate(frames, 1):
    out = Image.new("LA", (w, h), (26, 0))
    out.putalpha(Image.fromarray(a))
    out.crop(box).save(here / ("title%02d.png" % n), optimize=True)
print(FRAMES, "frames", box)
