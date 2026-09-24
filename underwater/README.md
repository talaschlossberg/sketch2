# Blue Hollow

A side-view dive through a flat, cut-paper lagoon, drawn with the 2D canvas (no libraries, no build step).

Open `index.html` through any local web server, for example:

    python3 -m http.server
    # then visit http://localhost:8000/underwater/

## Goal
Collect the 20 pearls from the clams along the seabed before your oxygen runs out.
Swim up to the surface to refill your tank, each pearl adds 10% O₂, and jellyfish stings cost 12%.

## Controls
- Arrow keys, or the arrow pad on screen: swim
- Click or tap: swim to that spot, or to a clam

## Art
Everything is flat paper: no lighting, no shadows, no perspective. Shapes sit side by side on the
seabed, the camera only follows the diver, and ambient motion runs at 6 frames a second with a
few slightly different cuts of each shape, like stop-motion. A paper-grain texture sits over the scene.

Every shape (fish, jellyfish, anemones, corals, sea fans, sponges, urchins, starfish, clams, rocks,
kelp and the diver) is cut in code; the game uses no image files.

`window.blueHollow` exposes the diver, game state, clams, fish and jellyfish for tinkering in the console.
Tuning constants (world size, pearl count, stop-motion rate) are at the top of `main.js`.
