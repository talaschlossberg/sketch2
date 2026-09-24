# Deep House

A dive through a flooded house, seen as a cut-open elevation, drawn with the 2D canvas
(no libraries, no build step).

Open `index.html` through any local web server, for example:

    python3 -m http.server
    # then visit http://localhost:8000/underwater/

## Goal
Twenty clams sit on the house's chairs, desks and shelves, each holding a pearl. Collect them all
before your air runs out. The only air left is a pocket under the roof in the attic; each pearl
adds 10% air and jellyfish stings cost 12%.

## Controls
- Arrow keys, or the arrow pad on screen: swim
- Click or tap: swim to that spot, or to a clam

When the game sits inside another page (an embed or a viewer), the keyboard only reaches it while
it has focus. The game takes focus when you start or click the house, and shows "Click the house
to use your arrow keys" whenever focus has moved elsewhere. The on-screen pad always works.

## The house
Attic (air pocket, a row of folding chairs), parlor, kitchen, bathroom, classroom, bedroom,
boiler cellar, and a hall of chairs facing a red door that opens onto nothing. Floors connect
through ladder hatches, and rooms through doorways.

## Art direction
Straight-on elevation, flat colour, thin ink lines, things set out in rows, stippled clouds and
lawn, a light colored-pencil grain, and ambient motion in small flip-book steps. The interface
follows a mid-century primer: a red number square and thin outlined cards. Every shape is drawn
in code; the game uses no image files.

`window.deepHouse` exposes the diver, game state, clams, fish and jellyfish for tinkering in the console.
