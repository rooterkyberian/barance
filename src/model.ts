import { BarSpec, RACK, plateSpec, Side } from './config';

/** A plate on a sleeve. `offset` = inner-edge distance from the sleeve shoulder, m. */
export interface PlacedPlate {
  kg: number;
  offset: number;
}

export interface ModelSnapshot {
  left: PlacedPlate[];
  right: PlacedPlate[];
  tray: [number, number][];
  moves: number;
}

/**
 * Pure game state: what is on the bar and where, what is in the tray, moves so
 * far. The physics sim mirrors this; this stays the source of truth (and is
 * what a future par-solver will search over).
 */
export class GameModel {
  readonly bar: BarSpec;
  left: PlacedPlate[] = []; // sorted inner → outer
  right: PlacedPlate[] = [];
  tray: Map<number, number>;
  moves = 0;

  constructor(bar: BarSpec, tray: Iterable<[number, number]>) {
    this.bar = bar;
    this.tray = new Map(tray);
  }

  sleeve(side: Side): PlacedPlate[] {
    return side === 'L' ? this.left : this.right;
  }

  /** Distance from bar centre to the sleeve shoulder. */
  sleeveStart(): number {
    return this.bar.length / 2 - this.bar.sleeveLength;
  }

  /** Bar-local x of the centre of a plate of `kg` at `offset` on `side`. */
  localX(side: Side, kg: number, offset: number): number {
    const u = this.sleeveStart() + offset + plateSpec(kg).width / 2;
    return side === 'L' ? -u : u;
  }

  outermost(side: Side): PlacedPlate | undefined {
    const s = this.sleeve(side);
    return s[s.length - 1];
  }

  /**
   * Offset range where a plate (or packed stack) of total `width` can go.
   * Plates load from the sleeve tip, so anything new must sit outboard of the
   * current outermost plate. Null if there is no room.
   */
  validRange(side: Side, width: number): { min: number; max: number } | null {
    const out = this.outermost(side);
    const min = out ? out.offset + plateSpec(out.kg).width : 0;
    const max = this.bar.sleeveLength - width;
    return max >= min - 1e-9 ? { min, max: Math.max(min, max) } : null;
  }

  attach(side: Side, kg: number, offset: number): void {
    this.sleeve(side).push({ kg, offset });
  }

  detachOutermost(side: Side): PlacedPlate | undefined {
    return this.sleeve(side).pop();
  }

  trayCount(kg: number): number {
    return this.tray.get(kg) ?? 0;
  }

  trayTake(kg: number): void {
    const c = this.trayCount(kg);
    if (c <= 0) throw new Error(`tray empty for ${kg} kg`);
    this.tray.set(kg, c - 1);
  }

  trayPut(kg: number): void {
    this.tray.set(kg, this.trayCount(kg) + 1);
  }

  sideMass(side: Side): number {
    return this.sleeve(side).reduce((a, p) => a + p.kg, 0);
  }

  totalMass(): number {
    return this.bar.mass + this.sideMass('L') + this.sideMass('R');
  }

  /** Centre of mass x of bar + attached plates (+ hypothetical extras). */
  comX(extra?: { side: Side; kg: number; offset: number }[]): number {
    let m = this.bar.mass;
    let mx = 0;
    for (const side of ['L', 'R'] as Side[]) {
      for (const p of this.sleeve(side)) {
        m += p.kg;
        mx += p.kg * this.localX(side, p.kg, p.offset);
      }
    }
    if (extra) {
      for (const e of extra) {
        m += e.kg;
        mx += e.kg * this.localX(e.side, e.kg, e.offset);
      }
    }
    return mx / m;
  }

  /**
   * The bar pivots about the OUTER edge of a hook seat, not its centre, so
   * that edge is the true support limit. |1| = CoM over the edge = tipping.
   */
  supportLimit(): number {
    return this.bar.hookHalfSpan + RACK.seatHalfW;
  }

  tipFraction(extra?: { side: Side; kg: number; offset: number }[]): number {
    return this.comX(extra) / this.supportLimit();
  }

  snapshot(): ModelSnapshot {
    return {
      left: this.left.map((p) => ({ ...p })),
      right: this.right.map((p) => ({ ...p })),
      tray: [...this.tray.entries()],
      moves: this.moves,
    };
  }

  restore(s: ModelSnapshot): void {
    this.left = s.left.map((p) => ({ ...p }));
    this.right = s.right.map((p) => ({ ...p }));
    this.tray = new Map(s.tray);
    this.moves = s.moves;
  }

  /** True if bar loadout + tray match the snapshot (used to detect no-op moves). */
  equalsState(s: ModelSnapshot): boolean {
    const eq = (a: PlacedPlate[], b: PlacedPlate[]) =>
      a.length === b.length &&
      a.every((p, i) => p.kg === b[i].kg && Math.abs(p.offset - b[i].offset) < 1e-9);
    if (!eq(this.left, s.left) || !eq(this.right, s.right)) return false;
    const t = new Map(s.tray);
    const keys = new Set([...this.tray.keys(), ...t.keys()]);
    for (const k of keys) {
      if ((this.tray.get(k) ?? 0) !== (t.get(k) ?? 0)) return false;
    }
    return true;
  }
}
