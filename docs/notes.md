# Notes

## Where things stand (2026-11-25)

The first version was built in one session on the drive to Wichita, as a Claude artifact. `index.html` is the whole app.

- **Yard:** 164 × 282 ft (1.06 acres), measured on the satellite map. The house, deck, and shed form a block about 88 × 40 ft inside the fence at the house end, on the left as you look out the back door. The house is drawn at the bottom, the way he walks out the back door.
- **Obstacles (from his marked-up photo):** an electrical box at about (154, 51) ft with a 4 ft keep-out, and a fire pit at about (40, 47) with an 8 ft keep-out (x from the left/south fence, y from the house end). A hilly area, an ellipse about 180 × 90 ft from mid back fence down to the south fence, is drawn but doesn't block anything. No jumps planned yet; the hill is for later design ideas.
- **Circles mode (main):** he places circle centers and sets a radius for each. The first circle is the roundabout, ridden counterclockwise, clockwise, or either (his call 11-25: don't lock it). The solver tries every set of the other circles, in every order and direction. Straights are tangent lines: the outer tangent when two circles go the same way, the crossing one when they go opposite ways (an S-bend). It rejects crossings, straights through circles, less than 6 ft of grass between sections, and anything that touches the house.
- **Who he cares about (11-25):** the back neighbors most. North (chickens and a dog) "aware": counted at −6 dB. South rides motorcycles too, so "don't mind": left out. Each is a select on the page.
- **Noise:** the lap sim (point mass: 40 mph cap, 0.3 g drive, 0.45 g brake, 0.7 g flat / 1.0 g bermed grip) labels every point full throttle, part throttle, or braking. Noise at each neighbor's door is the throttle level minus 20·log10(d / 50 ft). Neighbor doors are placed from the photo: five back doors about 45 ft past the back fence, the south house about 75 ft out, the north house about 30 ft out. The **ease-off zone** (back 100 ft, part throttle only) costs about 1 s a lap and brings the back neighbors from about −4.5 to −9 dB.
- **Grid / Draw modes:** removed 11-25 (his call: Circles does it better). In git history before that date.

## Open questions

- Check the north neighbor's distance from the fence (it reads about 30 ft on the photo; he guessed 20 yd).
- Safety: a faint line runs from the electrical box toward the house corner on the photo, possibly a buried line. Call 811 before digging berms or jumps.
- Check the house block (88 × 40 ft, deck included).
- How much is quiet worth? "Length and quiet" trades 100 ft of track for 1 dB at the back.
- Who rides, and how big are the jumps? That sets the minimum radius and the straight length a jump needs.
- Trees, septic, slope, wet spots: these should become blocked areas like the house.

## Next

- Let him drag the house block and add blocked areas (trees, septic, wet spots).
- Jumps on the hilly area, when he's ready to think about jumps.

## Standard

Set up 11-25 under the coding standard from the first commit: `npm run check` and CI. The grid generator now
avoids squares next to obstacles (`blockedCells`); before that, the house, fire pit and box rejected most grid
candidates, and the refactor's new random sequence rejected all of them. The test "grid batch tracks avoid
obstacles" caught it.

## 11-25 afternoon

- **Randomize:** 4 to 7 random circles that fit (`randomCircles` in core.js, bounded tries), retried up to 12 times
  until a set has a loop. About 60 ms a press. Test: 30 random sets, at least 20 solve.
- **Saved layouts:** localStorage (`backyard-track-lab.saves.v1`), newest 30 kept, per browser. Each save holds the
  circles, the chosen loop (by circle index and direction) and the settings; it's validated field by field when
  read back, and bad entries are skipped. Loading puts the saved loop first if it isn't in the top six.
- He's brainstorming and "having fun with it", so features over polish for now.
- **Exhaust direction (11-25 evening):** each point adds a pipe term: 0 dB with the door behind the bike, -5 dB
  straight ahead, +1 dB on the right (pipe side). Both numbers (`NOISE.spread`, `NOISE.side`) are estimates. To
  replace them, measure the real bike with a phone meter at 25 ft: front, back, left, right, at a steady rev.
- **Overlay:** the other top layouts draw as faint dashed lines under the selected one.
