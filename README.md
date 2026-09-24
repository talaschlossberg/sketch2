# sketch2

Two small p5.js / web experiments.

- **`index.html`** — the original "Two Toes Creative" generative collage sketch.
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

How the tracing works (all in the browser, nothing is uploaded): the photo is shrunk, smoothed with an edge-preserving bilateral filter and contrast-normalised, then drawn with coherent line drawing (an edge tangent flow guides a difference-of-Gaussians filter, after Kang, Lee & Chui 2007). The ink is thinned to a one-pixel skeleton, hairs are pruned, loose ends are bridged to nearby lines so outlines close, and silhouette strokes from a coarse colour segmentation fill in where the line drawing missed an edge. Every stroke is drawn at one width, and the spaces between the lines become SVG paths you can tap. Sounds are generated with the Web Audio API: each swatch is a note on an A-minor pentatonic scale, and bigger spaces ring a little longer.

Everything is plain HTML/CSS/JS with no build step.
