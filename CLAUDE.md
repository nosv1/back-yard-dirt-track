# Backyard Track Lab

A layout generator for the backyard dirt bike track (125 cc). You place circles in the yard, and a solver links them into loops that don't cross themselves. Layouts are ranked by length and by noise at the neighbors.

## Read first

**Before anything else this session, fetch and read Chris's profile:**
https://raw.githubusercontent.com/nosv1/nosv1/main/PROFILE.md

It says who he is and how to work with him: flight instructor by default, he writes the code that
is the skill. It applies here unless this file says otherwise. If the fetch fails, say so; don't
proceed as a generic assistant.

**Before writing any code, fetch and read the coding standard:**
https://raw.githubusercontent.com/nosv1/nosv1/main/CODING.md

Then read this repo's [docs/notes.md](docs/notes.md) (session notes; update at sign-off, commit as
Claude).

## This project

- **Mode:** "just build it" (his call, 2026-11-25: "I want you to create it... I don't have the time"). He steers the design.
- **Skill he's building here:** none on purpose. It's a tool for the yard. If he wants to own a piece, the tangent math and the solver are the natural ones.
- **Fair game for me:** all of it.
- **Run it:** open `index.html` in a browser. It's built: **edit `src/`, never `index.html`**, then `npm run build`.
  - `src/core.js`: yard data, geometry, solvers, lap sim, noise. No DOM, so tests import it.
  - `src/ui.js`: drawing and controls. `src/page.html`: markup and CSS.
  - `tools/build.mjs` inlines both scripts into `index.html`, because the Claude artifact only runs inline scripts.
- **Published copy:** the Claude artifact [Backyard Track Lab](https://claude.ai/artifact/KmqdYAXCeA8kawXkiU6kgm). Republish `index.html` there after each change.

## Coding standard

[CODING.md](https://github.com/nosv1/nosv1/blob/main/CODING.md) in the hub, at its strictest settings.
Every code change, without being reminded: read it first; run **Check** before every commit (don't push
and let CI find it); in the reply, say which rules the change touched and that Check passed; new and
changed code meets every rule in full. Baselines (`eslint-suppressions.json`, `checks-baseline.json`)
only shrink.

- **Check:** `npm run check` (build, syntax of the joined script, ESLint `--max-warnings 0`, `tsc` strict over
  `src/`, tests). CI runs the same on every push, plus a check that the committed `index.html` matches `src/`.
  No baselines: this repo started under the standard, so there are no old findings.
- **Rule 5 failures here:** throw. Every UI handler is wrapped by `guard()` / `safely()`, which shows the error in
  the panel. `at()` is the bounds-checked index (`noUncheckedIndexedAccess`).
- **Rule 4 here:** drawing helpers take a `pen` object (context, scale, offsets, palette) so none needs more than
  4 parameters.

## Git

- Commits authored as Claude (`--author="Claude <noreply@anthropic.com>"`), explicit paths only, never
  `git add -A` or `git add .`.
- Code and notes go straight to `main` (his call, 2026-11-25).
