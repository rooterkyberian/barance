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

/** A plate on the bar that the pointer can shove along its sleeve. */
export interface SlideTarget {
  side: Side;
  index: number;
}

export interface HoverState {
  trayKg: number | null;
  barSide: Side | null;
  canGrab: boolean;
  slide: SlideTarget | null;
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
  beginSlide(): void;
  slideTo(side: Side, index: number, offset: number): void;
  endSlide(): void;
  cancelSlide(): void;
}

interface Drag extends SlideTarget {
  pointerId: number;
  grabU: number; // |bar-local x| where the drag started
  startOffset: number;
}

const NO_HOVER: HoverState = { trayKg: null, barSide: null, canGrab: false, slide: null };

/**
 * Click-based interaction: click plates to stack them in hand (weightless),
 * click a sleeve to slide the whole stack on, click open floor to set it down,
 * right-click / Esc to put everything back where it came from. A plate that is
 * not outermost cannot be lifted past its neighbours, so it is dragged along the
 * sleeve instead, shoving whatever it runs into.
 */
export class Input {
  hover: HoverState = { ...NO_HOVER };
  private drag: Drag | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private view: Renderer,
    private game: GameHooks,
  ) {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.onDown(e);
    });
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.endDrag(e));
    canvas.addEventListener('pointercancel', (e) => this.endDrag(e));
    canvas.addEventListener('pointerleave', () => {
      if (this.drag) return;
      this.hover = { ...NO_HOVER };
      if (this.game.hand) this.game.hand.ghost = null;
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.drag) this.abortDrag();
      else this.game.cancelHand();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.drag) this.abortDrag();
      else this.game.cancelHand();
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

  /** Topmost plate under the pointer, searched tip-inward so the outer one wins. */
  private hitBarPlate(w: { x: number; y: number }): SlideTarget | null {
    const { lx, ly } = this.toBarLocal(w);
    const side: Side = lx < 0 ? 'L' : 'R';
    const model = this.game.model;
    const plates = model.sleeve(side);
    for (let i = plates.length - 1; i >= 0; i--) {
      const spec = plateSpec(plates[i].kg);
      const cx = model.localX(side, plates[i].kg, plates[i].offset);
      if (Math.abs(lx - cx) <= spec.width / 2 + 0.015 && Math.abs(ly) <= spec.diameter / 2 + 0.015) {
        return { side, index: i };
      }
    }
    return null;
  }

  private isOutermost(hit: SlideTarget): boolean {
    return hit.index === this.game.model.sleeve(hit.side).length - 1;
  }

  /** A plate is draggable when it has room to travel and the hand is free. */
  private slidableAt(w: { x: number; y: number }): SlideTarget | null {
    if (this.game.hand) return null;
    const hit = this.hitBarPlate(w);
    if (!hit || this.isOutermost(hit)) return null;
    const b = this.game.model.slideBounds(hit.side, hit.index);
    return b.max - b.min > 1e-9 ? hit : null;
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
      this.hover = { ...NO_HOVER };
      this.canvas.style.cursor = 'default';
      return;
    }
    const hand = this.game.hand;
    if (hand) {
      hand.world = w;
      hand.ghost = this.computeGhost(w);
    }
    const hit = this.hitBarPlate(w);
    const barSide = hit && this.isOutermost(hit) ? hit.side : null;
    const slide = this.slidableAt(w);
    const trayKg = hit === null ? this.hitTraySlot(w) : null;
    let canGrab = false;
    if (barSide) {
      const p = this.game.model.outermost(barSide);
      canGrab = !!p && this.fitsHand(p.kg);
    } else if (trayKg != null) {
      canGrab = this.game.model.trayCount(trayKg) > 0 && this.fitsHand(trayKg);
    }
    this.hover = { trayKg, barSide, canGrab, slide };

    let cursor = 'default';
    if (canGrab) cursor = hand ? 'copy' : 'grab';
    else if (slide) cursor = 'ew-resize';
    else if (hand?.ghost?.valid) cursor = 'pointer';
    this.canvas.style.cursor = cursor;
  }

  /** Bar-local distance from the bar centre, the axis plates travel along. */
  private sleeveU(w: { x: number; y: number }): number {
    return Math.abs(this.toBarLocal(w).lx);
  }

  private onMove(e: PointerEvent): void {
    const w = this.view.eventToWorld(e);
    const d = this.drag;
    if (!d) {
      this.updateAtPoint(w);
      return;
    }
    if (this.game.locked) {
      this.endDrag(e);
      return;
    }
    const steps = Math.round((this.sleeveU(w) - d.grabU) / PHYS.snapGrid);
    this.game.slideTo(d.side, d.index, d.startOffset + steps * PHYS.snapGrid);
    this.hover = { ...NO_HOVER, slide: { side: d.side, index: d.index } };
    this.canvas.style.cursor = 'grabbing';
  }

  private beginDrag(e: PointerEvent, w: { x: number; y: number }, hit: SlideTarget): void {
    this.drag = {
      ...hit,
      pointerId: e.pointerId,
      grabU: this.sleeveU(w),
      startOffset: this.game.model.sleeve(hit.side)[hit.index].offset,
    };
    this.canvas.setPointerCapture(e.pointerId);
    this.game.beginSlide();
    this.hover = { ...NO_HOVER, slide: hit };
    this.canvas.style.cursor = 'grabbing';
  }

  private endDrag(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture(d.pointerId)) this.canvas.releasePointerCapture(d.pointerId);
    this.game.endSlide();
    this.updateAtPoint(this.view.eventToWorld(e));
  }

  /** Esc / right-click mid-drag: put the whole sleeve back, free of charge. */
  private abortDrag(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture(d.pointerId)) this.canvas.releasePointerCapture(d.pointerId);
    this.game.cancelSlide();
    this.canvas.style.cursor = 'default';
  }

  private onDown(e: PointerEvent): void {
    if (this.game.locked) return;
    const w = this.view.eventToWorld(e);
    this.updateAtPoint(w);

    const hit = this.hitBarPlate(w);
    if (hit && this.isOutermost(hit)) {
      const p = this.game.model.outermost(hit.side);
      if (p && this.fitsHand(p.kg)) this.game.grabFromBar(hit.side);
      else this.game.flashOverCapacity();
      this.updateAtPoint(w);
      return;
    }

    const slide = this.slidableAt(w);
    if (slide) {
      this.beginDrag(e, w, slide);
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
