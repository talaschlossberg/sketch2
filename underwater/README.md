# Blue Hollow

A first-person underwater dive built with three.js (loaded from a CDN, no build step).

Open `index.html` through any local web server, for example:

    python3 -m http.server
    # then visit http://localhost:8000/underwater/

## Goal
Collect the 20 pearls hidden in clams on the floor of the lagoon before your oxygen runs out.
Surface to refill your tank, each pearl adds 10% O₂, and jellyfish stings cost 12%.

## Controls
- Mouse: look (click to lock the pointer, Esc to pause)
- W A S D: swim · Space / C: rise / sink · Shift: kick harder (uses more air) · F: dive torch
- Touch: left thumb swims, right thumb looks, Up / Dive buttons

## What's in the scene
- Procedural seabed (reef in the middle, winding trench, basin walls) with animated caustics
- Water surface seen from below with a Snell's window, god rays, marine snow
- ~640 schooling fish (boids, 5 species) that scatter from the diver
- Kelp forests and sea grass swaying in a vertex shader, coral, rocks, bubbling vents
- Glowing jellyfish, depth-based fog and light falloff, dive-computer HUD with sonar

`window.blueHollow` exposes the scene, camera, player and game state for tinkering in the console.
Tuning constants (world radius, pearl count, species list, oxygen rates) are at the top of `main.js`
and in the `SPECIES` array.
