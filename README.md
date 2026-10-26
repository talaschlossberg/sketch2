# sketch2

Small p5.js / web experiments.

- **`index.html`** — the original "Two Toes Creative" generative collage sketch.
- **`walk/`** — **Walk**: draw lines and walk a hand-drawn character along them with the arrow keys.
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

Open `walk/index.html` on a web server. Pick a sky at the top left: **Photo** (a film photo, `walk/sky/sunset.jpg`), **Sunset** (pink-lit clouds), **Day** (drifting clouds) or **Night** (stars, with the lines drawn in white). The painted skies live in `walk/sky.js`, with film grain to sit alongside the photo; the choice is remembered in that browser.

**Add door**, then click on a line, puts a door there and asks where it goes: a new room (furnished, drawn in the same pen, with a window onto the sky, a picture of the outside, a lamp, a table and chair she can jump onto, and a plant), a new empty room to draw in, a new outside, or a room you pick on the map. A new place comes with a door leading back. Doors are a real door cut from a film photo and straightened (`walk/doors/door.jpg`); going through, its panel swings open onto a dark doorway. Walk up to a door and press up to go through.

**Map** (or M) shows every place as a card with a snapshot, and a line with a little door for each link (dashed when the door only goes one way). Drag cards to arrange them, click one to go there, click a name to rename it, link loose doors, make new places, or delete one (press its × twice). Each place keeps its own lines and doors, each outside keeps its own sky, and Undo and Clear work on the place she's in (Clear leaves doors so links survive; Undo takes them away). The whole world is saved in that browser (`walk/rooms.js`, `walk/map.js`). Drag to draw lines; the left and right arrow keys walk him along them and up jumps (on a phone, use the on-screen arrows). He climbs gentle slopes, stops at steep ones, falls off the ends and drops back in from the top if he leaves the screen. **Undo** removes the last line, **Clear** removes them all.

The built-in walker is `walk/frames/walk01.png` to `walk22.png`, taken from a filmed walk cycle (`walk_cycle.mov`, 22 frames on a transparent background). The hand-drawn walker's frames are kept in `walk/drawn/`. To use another sequence, press **Choose folder** (or drop a folder anywhere on the page): the frames are sorted by filename and the frame speed is worked out from how far the feet move so they don't slide. Line drawings are also cleaned up: a white background is made see-through and the inside of the outline is filled so lines behind are hidden. Photos and video frames are used as they are. **Turn around** flips the walker if the frames face the other way. The last folder is remembered in that browser. All of this lives in `walk/frames.js`.
