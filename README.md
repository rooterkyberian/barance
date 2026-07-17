# Barance

A 2D physics puzzle: load and unload a barbell resting on squat-rack J-hooks to match target
configurations in the fewest moves. The bar is a real rigid body — load it asymmetrically and it
tips off the hooks. Tipping is emergent (torque about the hook-seat edge), never scripted.

**Status: M1 — physics sandbox.** Bar on hooks, plate drag/placement, CoM recompute, emergent
tipping, balance meter, move counter, three bar types.

## Play (current sandbox)

- **Click a plate** (tray or the outermost plate on a sleeve) to pick it up. Plates in hand are
  weightless — the bar rebalances the moment you lift one.
- **Keep clicking** to stack more plates in hand, up to the carry capacity (20 kg; a single plate
  always fits, so a lone 25 is carryable). One carry = **1 move**, however many plates it holds.
- **Click a sleeve** to slide the whole stack on (ghost preview shows where it lands; plates load
  from the tip, so new plates go outboard of existing ones).
- **Click the floor** to set the stack down; **right-click / Esc** puts everything back (free).
- Picking the outermost plate off and putting it back where it was counts 0 moves.
- If the bar tilts past **15°**, the level is failed — the fall still plays out in physics, and
  the plates unweld and slide along the sleeve (off the open end, if the tilt carries them there).
  *Undo last move & retry* restores the state before the fatal move.

## Physics notes

- [Rapier2D](https://rapier.rs/) (`@dimforge/rapier2d-compat`), fixed 120 Hz timestep with
  render interpolation; deterministic given the same move log.
- The bar is one dynamic body resting (not jointed) on two static hook seats. Attached plates are
  extra colliders on that body, so mass, CoM and inertia update exactly with every placement.
- The bar pivots about the **outer edge** of a hook seat (seats are 9 cm wide, like real
  J-hooks) — the balance meter's 100% is that edge, verified against the sim.
- During stable play plates are welded to the bar (deterministic resting contacts). When a drop
  starts (>15° tilt, roughly where steel-on-steel plates really slip), each plate becomes its own
  body on a prismatic joint along the bar axis — sleeve shoulder as the inner stop, and a plate
  sliding past the bar end comes free entirely.
- Tuning knobs live in `src/config.ts`: bar specs, plate specs, carry capacity, rack geometry,
  fail thresholds.

## Development

```sh
npm install
npm run dev      # vite dev server
npm run build    # typecheck + production build to dist/
npm run preview  # serve the build
```

`window.bl` exposes the game for console poking / headless tests:
`bl.grabFromTray(25); bl.placeHand('R', 0); bl.advance(2)`.

## Deploy

Pushing to `main` builds and deploys to GitHub Pages via `.github/workflows/deploy.yml`
(repo Settings → Pages → Source: **GitHub Actions**). `vite.config.ts` uses `base: './'`, so it
works under the project-page subpath.

## Code map

| File | Role |
|---|---|
| `src/config.ts` | All tuning data: bars, plates, rack, physics, capacity, fail rules |
| `src/model.ts` | Pure game state (loadout/tray/moves) — source of truth, future par-solver input |
| `src/sim.ts` | Rapier world mirroring the model; emergent tipping |
| `src/input.ts` | Click-based grab/stack/place interaction, ghost snapping |
| `src/render.ts` | Canvas renderer (world-space, interpolated) |
| `src/game.ts` | Controller: moves, fail/retry, HUD, fixed-step loop |

## Roadmap

- **M2 — game loop:** level targets, win detection, level select, 5 levels (JSON format), par/stars
- **M3 — content:** collars, sliding (uncollared) plates, 20+ levels, par calculator
- **M4 — polish:** replays, slow-mo on tip, sounds, camera shake
