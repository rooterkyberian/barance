# Barance

**▶ [Play it here](https://rooterkyberian.github.io/barance/)** — runs in the browser, no install.

A 2D physics puzzle: load and unload a barbell resting on squat-rack J-hooks to match target
configurations in the fewest moves. The bar is a real rigid body — load it asymmetrically and it
tips off the hooks. Tipping is emergent (torque about the hook-seat edge), never scripted.

**Status: M2 — generated challenges.** Bar on hooks, plate placement, CoM recompute, emergent
tipping, balance meter, three bar types, and seeded procedurally generated challenges with
par + stars. A free-play sandbox remains one click away.

## Challenges

Each challenge gives you a bar with plates already on it, a limited tray, and a **goal total
weight** (bar included). Reach the goal with the bar still standing (and your hands empty) to
win. Stars: ≤ par = ★★★, ≤ par + 2 = ★★, otherwise ★.

- Generation is **seeded** — the URL hash (`#c=seed.bar`) fully defines a challenge, so links
  are shareable and replayable.
- Every generated challenge is **solvable by construction**: the generator scrambles a stable
  target loadout (some plates missing, junk plates piled on) and then verifies a safe carry
  order exists — one where no intermediate state tips the bar, since lifting a plate off one
  side rebalances the bar instantly. The length of that plan is the par.
- Junk removal order matters: only outermost plates come off, and stripping the wrong side
  first can put the centre of mass past a hook. The tray may also contain decoy plates.

## Play

Live build: <https://rooterkyberian.github.io/barance/>

- **Click a plate** (tray or the outermost plate on a sleeve) to pick it up. Plates in hand are
  weightless — the bar rebalances the moment you lift one.
- **Keep clicking** to stack more plates in hand, up to the carry capacity (20 kg; a single plate
  always fits, so a lone 25 is carryable). One carry = **1 move**, however many plates it holds.
- **Click a sleeve** to slide the whole stack on (ghost preview shows where it lands; plates load
  from the tip, so new plates go outboard of existing ones).
- **Drag any plate** to shove it along the sleeve. It pushes whatever it runs into ahead of it, out
  to the sleeve tip or back against the shoulder; plates it never reaches keep their gaps. On the
  outermost plate a click lifts it off and a drag shoves it, so you can push a whole stack back in
  from the outside. Plates further in can't come off past their neighbours, only slide. One
  shove = **1 move**.
- **Click the floor** to set the stack down; **right-click / Esc** puts everything back (free).
  Mid-drag, the same puts the whole sleeve back where it was, also free.
- Picking the outermost plate off and putting it back where it was counts 0 moves. So does sliding a
  plate back to where it started — but only if it didn't shove anything on the way out.
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
- During stable play plates are welded to the bar (deterministic resting contacts). Shoving a plate
  re-seats its collider on the bar body, so mass, CoM and inertia follow the slide — dragging a
  loaded stack out toward the tip really can put the bar over the edge, and the threshold is the
  same one the balance meter shows, independent of how fast you drag. When a drop
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

Pushing to `main` builds and deploys to <https://rooterkyberian.github.io/barance/> via
`.github/workflows/deploy.yml` (repo Settings → Pages → Source: **GitHub Actions**).
`vite.config.ts` uses `base: './'`, so it works under the project-page subpath.

## Code map

| File | Role |
|---|---|
| `src/config.ts` | All tuning data: bars, plates, rack, physics, capacity, fail rules |
| `src/challenge.ts` | Seeded challenge generator + safe-carry planner (par, solvability) |
| `src/model.ts` | Pure game state (loadout/tray/moves) — source of truth |
| `src/sim.ts` | Rapier world mirroring the model; emergent tipping |
| `src/input.ts` | Click-based grab/stack/place interaction, ghost snapping |
| `src/render.ts` | Canvas renderer (world-space, interpolated) |
| `src/game.ts` | Controller: moves, fail/retry, HUD, fixed-step loop |

## Roadmap

- **M3 — content:** collars, authored/curated level sets, difficulty progression, constraint
  challenges (one-side access, limited floor space)
- **M4 — polish:** replays, slow-mo on tip, sounds, camera shake, best-score persistence
