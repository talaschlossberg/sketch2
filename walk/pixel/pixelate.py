# Run from the repo root: python3 walk/pixel/pixelate.py walk walk/pixel
# Pixel walkers: shrink each frame to a small sprite, cut the colours down to one
# shared palette, harden the edges, and add a one-pixel outline.
import glob, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

def union_bbox(ims):
    bb = None
    for im in ims:
        b = im.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
        bb = b if bb is None else (min(bb[0], b[0]), min(bb[1], b[1]), max(bb[2], b[2]), max(bb[3], b[3]))
    return bb

def pixelate(ims, height, colours, outline):
    bb = union_bbox(ims)
    w = round((bb[2] - bb[0]) * height / (bb[3] - bb[1]))
    small = [im.crop(bb).resize((w, height), Image.BOX) for im in ims]
    # one palette for all frames, so colours don't flicker from frame to frame
    strip = Image.new('RGB', (w * len(small), height))
    for i, s in enumerate(small):
        a = np.array(s)
        rgb = Image.fromarray(a[:, :, :3])
        strip.paste(rgb, (i * w, 0), Image.fromarray(((a[:, :, 3] > 110) * 255).astype(np.uint8)))
    pal = strip.quantize(colors=colours, method=Image.Quantize.MEDIANCUT)
    out = []
    for s in small:
        a = np.array(s)
        solid = a[:, :, 3] > 110
        q = np.array(Image.fromarray(a[:, :, :3]).quantize(palette=pal, dither=Image.Dither.NONE).convert('RGB'))
        o = np.zeros((height + 2, w + 2, 4), np.uint8)  # room for the outline
        o[1:-1, 1:-1, :3] = q
        o[1:-1, 1:-1, 3] = solid * 255
        m = o[:, :, 3] > 0
        grown = np.zeros_like(m)
        for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            grown |= np.roll(np.roll(m, dy, 0), dx, 1)
        edge = grown & ~m
        o[edge] = outline + (255,)
        out.append(Image.fromarray(o))
    return out

src = sys.argv[1]
dst = sys.argv[2]

# her: the filmed frames
her = [Image.open(f).convert('RGBA') for f in sorted(glob.glob(src + '/frames/walk*.png'))]
for i, im in enumerate(pixelate(her, 56, 12, (24, 18, 20))):
    im.save(f'{dst}/her{i + 1:02d}.png')

# him: the drawn frames, filled white inside the outline first, then reduced to two colours
him = []
for f in sorted(glob.glob(src + '/drawn/walk*.png')):
    im = Image.open(f).convert('RGBA')
    m = im.getchannel('A').point(lambda v: 255 if v > 40 else 0).filter(ImageFilter.MaxFilter(9))
    ImageDraw.floodfill(m, (0, 0), 128)
    inside = np.array(m.point(lambda v: 0 if v == 128 else 255).filter(ImageFilter.MinFilter(5))) > 0
    a = np.array(im).astype(float)
    al = a[:, :, 3:4] / 255
    rgb = a[:, :, :3] * al + 255 * (1 - al)
    a[:, :, :3] = rgb
    a[inside, 3] = 255
    him.append(Image.fromarray(a.astype(np.uint8)))
# his pen lines are thin: at sprite size they're pale grey, so anything not near-white becomes ink
bb = union_bbox(him)
height = 72
w = round((bb[2] - bb[0]) * height / (bb[3] - bb[1]))
for i, im in enumerate(him):
    small = np.array(im.crop(bb).resize((w, height), Image.BOX)).astype(float)
    solid = small[:, :, 3] > 110
    grey = small[:, :, :3].mean(axis=2)
    o = np.zeros((height + 2, w + 2, 4), np.uint8)
    o[1:-1, 1:-1, :3] = np.where((grey < 238)[:, :, None], 20, 255)
    o[1:-1, 1:-1, 3] = solid * 255
    m = o[:, :, 3] > 0
    grown = np.zeros_like(m)
    for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        grown |= np.roll(np.roll(m, dy, 0), dx, 1)
    o[grown & ~m] = (20, 20, 20, 255)
    Image.fromarray(o).save(f'{dst}/him{i + 1}.png')
print('ok')
