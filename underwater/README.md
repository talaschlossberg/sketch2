# Deep House

A flooded house with doors to other places. It isn't a game: there's no air, clock or score.
Swim around the house, then swim into one of the glowing openings to go somewhere else.
Drawn with the 2D canvas (no libraries, no build step).

Open `index.html` through any local web server, for example:

    python3 -m http.server
    # then visit http://localhost:8000/underwater/

## Places
1. **The House**: a cut-open house full of water, seen from the side. You float.
2. **The Dune** (through the red door in the hall): pink desert dunes with monoliths, a huge
   sun and rolling tumbleweeds. You walk and jump.
3. **The Snowfield** (through the classroom wardrobe): seen from above. You leave footprints,
   and you slide on the frozen pond.
4. **The Night Sky** (through the round attic window): stars, a moon, comets and floating
   islands. You drift, and nearby stars join up to you like a constellation.
5. **The Grandstand** (through the parlor painting): huge grey bleachers scattered with
   briefcases above a yellow fog. The steps carry you up as you walk.

Every place has a door, window or frame that leads back to the house.

## Controls
- Arrow keys, or the arrow pad on screen: move (↑ jumps where there's ground)
- Click or tap: go to that spot

When the page sits inside another page (an embed or a viewer), the keyboard only reaches it
while it has focus. It takes focus when you start or click, and shows "Click the house to use
your arrow keys" whenever focus has moved elsewhere. The on-screen pad always works.

## Look
Flat colour and thin ink lines, printed lo-fi: the scene is drawn at reduced resolution, printed
a second time slightly out of register, and covered with flickering grain and paper fibres.
Ambient motion moves in small flip-book steps. Every shape is drawn in code; no image files.

Each place lives in its own block in `main.js` (`HOUSE`, `DUNE`, `SNOW`, `NIGHT`, `STAND`) with its
own palette, movement mode (`float`, `walk` or `top`) and portals. `window.deepHouse.go('dune')`
jumps to a place from the console.
