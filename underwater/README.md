# Blue Hollow

A lagoon dive drawn as a flat elevation, using the 2D canvas (no libraries, no build step).

Open `index.html` through any local web server, for example:

    python3 -m http.server
    # then visit http://localhost:8000/underwater/

## Goal
Collect the 20 pearls from the clams on the steps of the lagoon floor before your air runs out.
Swim up to the surface to breathe, each pearl adds 10% air, and jellyfish stings cost 12%.

## Controls
- Arrow keys, or the arrow pad on screen: swim
- Click or tap: swim to that spot, or to a clam

## Art direction
Everything is seen straight on, like an architectural elevation or a folk painting: a stepped
seabed, things set out in evenly spaced rows, fish swimming in formation along straight lanes,
flat colour with thin ink lines, sponge-stipple texture on hedges, rocks and clouds, and a
colored-pencil grain over the whole scene. Ambient motion moves in small flip-book steps.
The interface borrows from mid-century primers: a red number square and thin outlined cards.

Every shape is drawn in code; the game uses no image files.

`window.blueHollow` exposes the diver, game state, clams, fish and jellyfish for tinkering in the console.
Tuning constants (world size, pearl count, step size, flip-book rate) are at the top of `main.js`.
