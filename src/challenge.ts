import { BARS, BarSpec, CARRY_CAPACITY_KG, PLATE_LIST, RACK, plateSpec } from './config';
import type { PlacedPlate } from './model';

/**
 * A generated puzzle: plates already on the bar, a limited tray, and a goal
 * total weight (bar included) to reach with the bar still standing.
 */
export interface Challenge {
  seed: number;
  barId: string;
  left: PlacedPlate[]; // starting plates, packed inner → outer
  right: PlacedPlate[];
  tray: [number, number][];
  goal: number; // kg, bar + plates
  par: number; // carries in the generator's own safe plan
  targetSide: number[]; // the constructed per-side solution, inner → outer
}

/** Small deterministic PRNG so a seed fully defines a challenge. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const width = (a: number[]) => a.reduce((x, kg) => x + plateSpec(kg).width, 0);

function pack(kgs: number[]): PlacedPlate[] {
  let o = 0;
  return kgs.map((kg) => {
    const p = { kg, offset: o };
    o += plateSpec(kg).width;
    return p;
  });
}

/** Tip fraction for plates packed flush from each shoulder (mirrors GameModel.tipFraction). */
function packedTip(bar: BarSpec, L: number[], R: number[]): number {
  const s0 = bar.length / 2 - bar.sleeveLength;
  let m = bar.mass;
  let mx = 0;
  const acc = (arr: number[], sgn: number) => {
    let o = 0;
    for (const kg of arr) {
      const w = plateSpec(kg).width;
      mx += sgn * kg * (s0 + o + w / 2);
      o += w;
      m += kg;
    }
  };
  acc(L, -1);
  acc(R, 1);
  return mx / (m * (bar.hookHalfSpan + RACK.seatHalfW));
}

const SAFE_TIP = 0.97;

function prefixLen(arr: number[], target: number[]): number {
  let n = 0;
  while (n < arr.length && n < target.length && arr[n] === target[n]) n++;
  return n;
}

/**
 * Plan a carry sequence from the start state to the target loadout, greedily
 * choosing whichever next carry keeps the bar most balanced. A carry either
 * strips consecutive outermost non-target plates from one side (≤ capacity)
 * or adds the next needed target plates to one side. Returns the number of
 * carries (the par), or null if every order tips the bar — an unplayable
 * scramble.
 */
export function planCarries(
  bar: BarSpec,
  startL: number[],
  startR: number[],
  target: number[],
): number | null {
  const state = { L: [...startL], R: [...startR] };
  let par = 0;
  for (let iter = 0; iter < 64; iter++) {
    const candidates: { L: number[]; R: number[] }[] = [];
    for (const s of ['L', 'R'] as const) {
      const arr = state[s];
      const pre = prefixLen(arr, target);
      if (pre < arr.length) {
        let carried = 0;
        let take = 0;
        for (let i = arr.length - 1; i >= pre; i--) {
          if (take > 0 && carried + arr[i] > CARRY_CAPACITY_KG + 1e-9) break;
          carried += arr[i];
          take++;
        }
        const next = arr.slice(0, arr.length - take);
        candidates.push(s === 'L' ? { L: next, R: state.R } : { L: state.L, R: next });
      } else if (arr.length < target.length) {
        const added: number[] = [];
        let carried = 0;
        for (let i = arr.length; i < target.length; i++) {
          if (added.length > 0 && carried + target[i] > CARRY_CAPACITY_KG + 1e-9) break;
          carried += target[i];
          added.push(target[i]);
          if (carried > CARRY_CAPACITY_KG) break; // a single overweight plate travels alone
        }
        const next = [...arr, ...added];
        candidates.push(s === 'L' ? { L: next, R: state.R } : { L: state.L, R: next });
      }
    }
    if (candidates.length === 0) return par; // both sides match the target
    let best: { L: number[]; R: number[] } | null = null;
    let bestF = Infinity;
    for (const c of candidates) {
      const f = Math.abs(packedTip(bar, c.L, c.R));
      if (f < bestF) {
        bestF = f;
        best = c;
      }
    }
    if (!best || bestF > SAFE_TIP) return null;
    state.L = best.L;
    state.R = best.R;
    par++;
  }
  return null;
}

export function generateChallenge(seed: number, barId: string): Challenge {
  const rng = mulberry32(seed);
  const bar = BARS.find((b) => b.id === barId) ?? BARS[0];
  for (let attempt = 0; attempt < 80; attempt++) {
    // symmetric target loadout — its total is the goal
    const nSide = 1 + Math.floor(rng() * 4);
    const kgs: number[] = [];
    for (let i = 0; i < nSide; i++) {
      kgs.push(PLATE_LIST[Math.floor(rng() * PLATE_LIST.length)].kg);
    }
    kgs.sort((a, b) => b - a);
    while (kgs.length && width(kgs) > bar.sleeveLength - 0.02) kgs.pop();
    if (!kgs.length) continue;
    const goal = bar.mass + 2 * sum(kgs);

    // scramble: keep an inner prefix per side, pile junk outboard of it
    const keptLenL = Math.floor(rng() * (kgs.length + 1));
    const keptLenR = Math.floor(rng() * (kgs.length + 1));
    const startL = kgs.slice(0, keptLenL);
    const startR = kgs.slice(0, keptLenR);
    const junkCount = Math.floor(rng() * 4);
    for (let j = 0; j < junkCount; j++) {
      const kg = PLATE_LIST[Math.floor(rng() * PLATE_LIST.length)].kg;
      (rng() < 0.5 ? startL : startR).push(kg);
    }
    if (
      width(startL) > bar.sleeveLength - 0.005 ||
      width(startR) > bar.sleeveLength - 0.005
    ) {
      continue;
    }
    if (Math.abs(packedTip(bar, startL, startR)) > 0.9) continue; // must start stable
    const startTotal = bar.mass + sum(startL) + sum(startR);
    if (Math.abs(startTotal - goal) < 1e-9) continue; // already at goal — no puzzle

    const par = planCarries(bar, startL, startR, kgs);
    if (par === null || par < 1) continue;

    // tray: the solution plates not on the bar, plus a few decoys
    const tray = new Map<number, number>();
    const put = (kg: number) => tray.set(kg, (tray.get(kg) ?? 0) + 1);
    for (const kg of kgs.slice(keptLenL)) put(kg);
    for (const kg of kgs.slice(keptLenR)) put(kg);
    const nDecoy = Math.floor(rng() * 3);
    for (let j = 0; j < nDecoy; j++) {
      put(PLATE_LIST[Math.floor(rng() * PLATE_LIST.length)].kg);
    }

    return {
      seed,
      barId: bar.id,
      left: pack(startL),
      right: pack(startR),
      tray: [...tray.entries()],
      goal,
      par,
      targetSide: kgs,
    };
  }
  // deterministic fallback — practically unreachable
  return {
    seed,
    barId: bar.id,
    left: [],
    right: [],
    tray: [[10, 2]],
    goal: bar.mass + 20,
    par: 2,
    targetSide: [10],
  };
}
