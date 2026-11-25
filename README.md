# Backyard Track Lab

A layout generator for a backyard dirt bike track. Place circles in the yard, and a solver links them into
loops you can ride. It ranks the loops by length and by how loud they are for the neighbors.

**Open it:** [nosv1.github.io/back-yard-dirt-track](https://nosv1.github.io/back-yard-dirt-track/). It's one page
with nothing to install, and it works on a phone.

## Using it

The page opens on **Circles** with an example already solved.

- **Tap the yard** to drop a circle, and **drag** a circle to move it. Change the selected circle's size with the
  radius slider.
- The **orange circle is the roundabout**. Every layout goes through it. You choose the direction: either way,
  counterclockwise, or clockwise.
- The **six thumbnails** are the best ways to link the circles. Tap one to see it in full.
- A **red circle** is too close to the fence, the house, a keep-out, or another circle. Move it or make it smaller.

The panel shows each layout's length, a simulated lap time, top speed, corners, hairpins, jumps, the closest point
where two parts of the track pass each other, and how loud it is at each neighbor.

**Grid** and **Draw** are the first version, which works on 20 ft squares. Draw lets you lay a few pieces and have
the solver finish the loop, like the track tool in Roller Coaster Tycoon.

## How it works

**Every corner is part of a circle, and every straight is a line touching two circles.** If two circles are
ridden the same way, the outside line joins them, like a belt on two pulleys. If they're ridden opposite ways,
the crossing line joins them, which makes an S-bend. A layout is an ordered list of circles, each ridden one way
or the other.

**The solver** tries every set of the other circles, in every order and both directions, always through the
roundabout. That's up to about 150,000 loops for 7 circles. It throws out any loop where:

- a straight crosses another straight
- a straight cuts through a circle it doesn't belong to
- the track touches the house, the fire pit, or the electrical box
- two parts of the track come within 6 ft of grass of each other

It then ranks what's left and keeps the best six.

**The lap sim** treats the bike as a point. It has a 40 mph cap, 0.3 g of drive, 0.45 g of braking, and grip of
0.7 g on flat turns and 1.0 g on bermed ones. It records where the bike is on full throttle, part throttle, or
braking, and the track is drawn in those colors. Past the "ease off" line near the back fence, it only uses part
throttle. Use the lap times to compare layouts, not as predictions.

**Noise** is measured at each neighbor's door, compared with full throttle 50 ft away. It drops 6 dB each time
the distance doubles. Each neighbor gets a care level, from "most careful" to "don't mind," and layouts are ranked
by the loudest neighbor after that.

The yard is 164 × 282 ft, measured on a satellite map. The house, keep-outs, and neighbor positions come from the
same map. All of them live at the top of [src/core.js](src/core.js).

## Working on it

```sh
npm install        # once
npm run build      # src/ -> index.html
npm run check      # build, lint, strict types, tests: what CI runs
```

- [src/core.js](src/core.js): yard data, geometry, the solvers, the lap sim and the noise model. It has no browser
  code, so the tests can load it.
- [src/ui.js](src/ui.js): drawing and controls. [src/page.html](src/page.html): markup and styles.
- [tools/build.mjs](tools/build.mjs) joins them into `index.html`, one self-contained page. **Edit `src/`, not
  `index.html`.** CI fails if `index.html` doesn't match the sources.
- [tests/core.test.mjs](tests/core.test.mjs): checks the tangent math, the solver, the noise model, and both
  "finish the loop" solvers.

The code follows a NASA/JPL "Power of 10" coding standard, described in
[CODING.md](https://github.com/nosv1/nosv1/blob/main/CODING.md): small functions, bounded loops, checked inputs,
and zero lint warnings with strict types.
