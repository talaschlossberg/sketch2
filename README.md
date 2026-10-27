# sketch2

Small p5.js / web experiments.

- **`index.html`** — the original "Two Toes Creative" generative collage sketch.
- **`walk/`** — **Walk**: draw lines and walk a filmed character along them, through doors into rooms you build.
- **`coloring/`** — **Snap & Color**: take a photo, turn it into a coloring-book outline, and tap the spaces to fill them. Every color plays its own note.

## Snap & Color

Open `coloring/index.html` on any web server (GitHub Pages works: `https://<user>.github.io/sketch2/coloring/`).

On a phone:

1. Open the page in Safari (iOS) or Chrome (Android).
2. **Photo** opens the camera; the picture-frame button picks an existing photo.
3. Wait a second while the photo is traced, then tap any space to color it. Pinch to zoom, drag to pan.
4. **Detail** slider + **Retrace** changes how many spaces the tracer finds.
5. **Save** shares/downloads a PNG; **SVG** downloads the vector file.
6. Use "Add to Home Screen" (Share menu on iOS, browser menu on Android) to install it as an app. It works offline after the first visit.

How the tracing works (all in the browser, nothing is uploaded): the photo is shrunk and lightly blurred, then a small neural line-art model (Informative Drawings, MIT licence, see `coloring/model/README.md`) draws it as a pen sketch using ONNX Runtime Web. The sketch is thresholded with hysteresis, thinned to a one-pixel skeleton, hairs are pruned, loose ends are bridged to nearby lines so outlines close, and every stroke is drawn at one width. The spaces between the lines become SVG paths you can tap. If the model cannot load (for example offline on a first visit), a classic coherent-line-drawing tracer takes over. Sounds are generated with the Web Audio API: each swatch is a note on an A-minor pentatonic scale, and bigger spaces ring a little longer.

The model is about 17 MB and downloads once; the service worker keeps it for later visits. Tracing takes a few seconds on a phone.

Everything is plain HTML/CSS/JS with no build step.

## Walk

Open `walk/index.html` on a web server. She walks on the lines you draw: the arrow keys walk, up jumps or goes through a door, and M opens the map. On a phone, arrows appear on screen.

**Tools** (the rail down the left):

- **Select**: drag a line, door or photo to move it; drag the corner square, press + and -, or scroll over it to resize. Doors settle onto the line below.
- **Pencil**: draw lines, in pen with a slight wobble.
- **Path**: click point to point for straight lines; double-click or press Enter to finish.
- **Fill**: click inside a shape you've drawn to fill it with one of nine colours, like gouache under the ink. Lines, the floor, doors and photos all count as edges; a space that isn't closed in can't be filled. Filling a filled shape changes its colour.
- **Eraser**: drag over lines to rub out just the parts you touch; click a door, photo or fill to take it away.
- **Photo**: drag a box and choose a photo; it keeps its shape inside the box.
- **Door**: click on a line to put up a real door (cut from a film photo, `walk/doors/door.jpg`), then choose where it goes: a new outside (blue on grass), a new furnished room (on boards), a new empty room (plaster on boards), or a place picked on the map. New places come with a door back.

**Every page is a world**: a wall and a floor, chosen from the bar's **Wall** and **Floor** pickers (each option shows a little preview). Walls: Blue, Clouds (drifting), Sunset, Night (lines drawn in white), Your photo (a photo of your own for that page, with **Change photo**; a film sunset until you choose one), Plaster, and Room (furnished: a window onto the last sky picked, a picture of the outside, a lamp, a table and chair she can jump onto, a plant). Floors: Grass, Sand, Boards, Tiles, Concrete and Clay, painted in perspective from a horizon with the texture finer toward it, or Line, the plain drawn ground. On a painted floor she walks the ground a little below the horizon, with a soft shadow under her that shrinks and fades as she jumps (`walk/world.js`).

**The bar** across the top: the place's name; **Wall** and **Floor**; **Map** (every place as a card with a snapshot and its links; drag, rename, visit, link loose doors, add or delete places); **Undo**; **Clear** (lines and fills; doors and photos stay); and **?** for the keys.

The walker is `walk/frames/walk01.png` to `walk22.png`, from a filmed walk cycle; `walk/frames/make_frames.py` makes them (the loop's head jolt taken out, detail brought out in her dark clothes). The frames advance with the distance she covers, so her feet don't slide, and she leans to sit flat on slopes.

Everything is saved in the browser (IndexedDB). Type and colour follow PMT and Tala Games: monospace on paper, small spaced capitals, red for what's live.

Code: `sketch.js` (walking, drawing, the loop), `world.js` (walls, floors, the shadow), `rooms.js` (rooms, doors, saving), `map.js`, `sky.js` (the painted skies, your photo), `tools.js` (the rail, the eraser), `make.js` (path, select), `fill.js`, `images.js`, `frames.js` (preparing the walk frames).
