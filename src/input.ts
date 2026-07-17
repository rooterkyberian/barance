import { CARRY_CAPACITY_KG, PHYS, PLATE_LIST, TRAY_SLOT_X, plateSpec, Side } from './config';
import type { GameModel } from './model';
import type { Pose } from './sim';
import type { Renderer } from './render';

export interface HeldPlate {
  kg: number;
  from: { type: 'tray' } | { type: 'bar'; side: Side; offset: number };
}

/** Candidate landing spot for the whole hand stack. `offset` = inner edge. */
export interface Ghost {
  side: Side;
  offset: number;
  valid: boolean;
}

export interface Hand {
  plates: HeldPlate[]; // grab order; placed in reverse (first grabbed lands outermost)
  world: { x: number; y: number };
  ghost: Ghost | null;
}

export interface HoverState {
  trayKg: number | null;
  barSide: Side | null;
  canGrab: boolean;
}

export interface GameHooks {
  readonly model: GameModel;
  readonly locked: boolean;
  readonly hand: Hand | null;
  barPose(): Pose;
  grabFromTray(kg: number): void;
  grabFromBar(side: Side): void;
  placeHand(side: Side, offset: number): void;
  dropHandToTray(): void;
  cancelHand(): void;
  flashOverCapacity(): void;
}

/**
 * Click-based interaction: click plates to stack them in hand (weightless),
 * click a sleeve to slide the whole stack on, click open floor to set it down,
 * right-click / Esc to put everything back where it came from.
 */
export class Input {
  hover: HoverState = { trayKg: null, barSide: null, canGrab: false };

  constructor(
    private canvas: HTMLCanvasElement,
    private view: Renderer,
    private game: GameHooks,
  ) {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.onDown(e);
    });
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerleave', () => {
      this.hover = { trayKg: null, barSide: null, canGrab: false };
      if (this.game.hand) this.game.hand.ghost = null;
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.game.cancelHand();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.game.cancelHand();
    });
  }

  private heldKg(): number {
    return this.game.hand?.plates.reduce((a, p) => a + p.kg, 0) ?? 0;
  }

  /** A grab is allowed when the hand is empty (one plate always fits) or the cap holds. */
  private fitsHand(kg: number): boolean {
    return !this.game.hand || this.heldKg() + kg <= CARRY_CAPACITY_KG + 1e-9;
  }

  private toBarLocal(w: { x: number; y: number }): { lx: number; ly: number } {
    const p = this.game.barPose();
    const dx = w.x - p.x;
    const dy = w.y - p.y;
    const c = Math.cos(p.angle);
    const s = Math.sin(p.angle);
    return { lx: c * dx + s * dy, ly: -s * dx + c * dy };
  }

  private hitTraySlot(w: { x: number; y: number }): number | null {
    for (let i = 0; i < PLATE_LIST.length; i++) {
      const spec = PLATE_LIST[i];
      const x = TRAY_SLOT_X[i];
      if (Math.abs(w.x - x) < 0.115 && w.y > -0.02 && w.y < Math.max(spec.diameter, 0.2) + 0.06) {
        return spec.kg;
      }
    }
    return null;
  }

  private inTrayZone(w: { x: number; y: number }): boolean {
    return w.y < 0.55;
  }

  private hitBarOutermost(w: { x: number; y: number }): Side | null {
    const { lx, ly } = this.toBarLocal(w);
    const side: Side = lx < 0 ? 'L' : 'R';
    const p = this.game.model.outermost(side);
    if (!p) return null;
    const spec = plateSpec(p.kg);
    const cx = this.game.model.localX(side, p.kg, p.offset);
    if (Math.abs(lx - cx) <= spec.width / 2 + 0.015 && Math.abs(ly) <= spec.diameter / 2 + 0.015) {
      return side;
    }
    return null;
  }

  private computeGhost(w: { x: number; y: number }): Ghost | null {
    const hand = this.game.hand;
    if (!hand || hand.plates.length === 0) return null;
    const model = this.game.model;
    const bar = model.bar;
    const total = hand.plates.reduce((a, p) => a + plateSpec(p.kg).width, 0);
    const { lx, ly } = this.toBarLocal(w);
    const s0 = model.sleeveStart();
    const uc = Math.abs(lx);
    if (Math.abs(ly) > 0.4 || uc < s0 - 0.1 || uc > bar.length / 2 + 0.25) return null;
    const side: Side = lx < 0 ? 'L' : 'R';
    const desired = uc - s0 - total / 2; // centre the stack under the cursor
    const range = model.validRange(side, total);
    if (!range) {
      const off = Math.max(0, Math.min(desired, bar.sleeveLength - total));
      return { side, offset: off, valid: false };
    }
    let off = Math.round(desired / PHYS.snapGrid) * PHYS.snapGrid;
    off = Math.min(Math.max(off, range.min), range.max);
    if (off - range.min < 0.02) off = range.min; // magnet: snap flush against the stack below
    return { side, offset: off, valid: true };
  }

  private updateAtPoint(w: { x: number; y: number }): void {
    if (this.game.locked) {
      this.hover = { trayKg: null, barSide: null, canGrab: false };
      this.canvas.style.cursor = 'default';
      return;
    }
    const hand = this.game.hand;
    if (hand) {
      hand.world = w;
      hand.ghost = this.computeGhost(w);
    }
    const barSide = this.hitBarOutermost(w);
    const trayKg = barSide === null ? this.hitTraySlot(w) : null;
    let canGrab = false;
    if (barSide) {
      const p = this.game.model.outermost(barSide);
      canGrab = !!p && this.fitsHand(p.kg);
    } else if (trayKg != null) {
      canGrab = this.game.model.trayCount(trayKg) > 0 && this.fitsHand(trayKg);
    }
    this.hover = { trayKg, barSide, canGrab };

    let cursor = 'default';
    if (canGrab) cursor = hand ? 'copy' : 'grab';
    else if (hand?.ghost?.valid) cursor = 'pointer';
    this.canvas.style.cursor = cursor;
  }

  private onMove(e: PointerEvent): void {
    this.updateAtPoint(this.view.eventToWorld(e));
  }

  private onDown(e: PointerEvent): void {
    if (this.game.locked) return;
    const w = this.view.eventToWorld(e);
    this.updateAtPoint(w);

    const barSide = this.hitBarOutermost(w);
    if (barSide) {
      const p = this.game.model.outermost(barSide);
      if (p && this.fitsHand(p.kg)) this.game.grabFromBar(barSide);
      else this.game.flashOverCapacity();
      this.updateAtPoint(w);
      return;
    }

    const trayKg = this.hitTraySlot(w);
    if (trayKg != null && this.game.model.trayCount(trayKg) > 0) {
      if (this.fitsHand(trayKg)) this.game.grabFromTray(trayKg);
      else this.game.flashOverCapacity();
      this.updateAtPoint(w);
      return;
    }

    const hand = this.game.hand;
    if (hand) {
      if (hand.ghost?.valid) {
        this.game.placeHand(hand.ghost.side, hand.ghost.offset);
      } else if (this.inTrayZone(w)) {
        this.game.dropHandToTray();
      }
      this.updateAtPoint(w);
    }
  }
}
