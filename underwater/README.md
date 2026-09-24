# Deep House

A flooded house with doors to other places. It isn't a game: nothing to win or lose.
In every place you become a different creature that moves in its own way, and every place
has portals onward. Drawn with the 2D canvas (no libraries, no build step).

Open `index.html` through any local web server, for example:

    python3 -m http.server
    # then visit http://localhost:8000/underwater/

## Places and their creatures

| # | Place | You are | How you move | Doors to |
|---|-------|---------|--------------|----------|
| 1 | The House | a diver | swim | Night Sky, Grandstand, Shapes, Dune, The Hour |
| 2 | The Night Sky | a lantern-bearer | drift; nearby stars join up to you | House, Orbits, Mirror |
| 3 | The Dune | a parasol walker | walk, ↑ jumps | House, Shapes, Grandstand |
| 4 | The Grandstand | a briefcase on legs | hop one step at a time, ↑ hops high | House, The Hour, Dune |
| 5 | The Hour | a little alarm clock | ← → circle the clock face, ↑ ↓ move out and in; time runs slow at the centre and your recent past follows as echoes | House, Grandstand, Mirror, Shapes |
| 6 | The Shapes | a polygon with an eye | tumble corner over corner; ↑ adds a corner, ↓ removes one (triangle to circle) | House, Dune, Orbits, The Hour |
| 7 | The Orbits | a small moon | arrows fire small thrusts, gravity does the rest; a dotted trail draws your orbit | Night Sky, Shapes, Mirror |
| 8 | The Mirror | a spark | steer like a comet (← → turn, ↑ faster, ↓ slower); your trail is mirrored twelve ways | The Hour, Night Sky, Orbits |

Portals show a flickering slice of where they lead and carry a tag with its name. After you
arrive somewhere you have to step out of the portal before it can take you back.

## Controls
- Arrow keys, or the arrow pad on screen
- Click or tap: head for that spot

When the page sits inside another page (an embed or a viewer), the keyboard only reaches it
while it has focus. It takes focus when you start or click, and shows "Click the house to use
your arrow keys" whenever focus has moved elsewhere. The on-screen pad always works.

## Look
Flat colour and thin ink lines, printed lo-fi: the scene is drawn at reduced resolution, printed
a second time slightly out of register, and covered with flickering grain and paper fibres.
Ambient motion moves in small flip-book steps. Every shape is drawn in code; no image files.

## Code
Each place is one block in `main.js` (`HOUSE`, `NIGHT`, `DUNE`, `STAND`, `CLOCK`, `SHAPES`,
`ORBIT`, `MIRROR`) with its own palette, `move()` (how its creature moves), `draw()`, `avatar()`
and `portals`. To add a place, write a block like these, add it to `WORLDS` and `WORLD_ORDER`,
and point a portal at it. `window.deepHouse.go('orbit')` jumps to a place from the console.
