import {
  BARS,
  CARRY_CAPACITY_KG,
  DEFAULT_TRAY,
  FAIL,
  PHYS,
  Side,
  plateSpec,
} from './config';
import { GameModel, ModelSnapshot } from './model';
import { LoosePose, Pose, Sim } from './sim';
import { FrameInfo, Renderer, fmtKg } from './render';
import { GameHooks, Hand, Input } from './input';

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

export class Game implements GameHooks {
  model: GameModel;
  hand: Hand | null = null;
  failed = false;

  private sim = new Sim();
  private renderer: Renderer;
  private input: Input;
  private preMove: ModelSnapshot | null = null;
  private tiltSteps = 0;
  private overCapUntil = 0;

  private prevPose: Pose = { x: 0, y: 0, angle: 0 };
  private currPose: Pose = { x: 0, y: 0, angle: 0 };
  private acc = 0;
  private lastT: number | null = null;

  private overlay = must<HTMLDivElement>('overlay');
  private btnRetry = must<HTMLButtonElement>('btn-retry');
  private stTotal = must<HTMLSpanElement>('stat-total');
  private stLeft = must<HTMLSpanElement>('stat-left');
  private stRight = must<HTMLSpanElement>('stat-right');
  private stBalance = must<HTMLSpanElement>('stat-balance');
  private stCarry = must<HTMLSpanElement>('stat-carry');
  private stMoves = must<HTMLSpanElement>('stat-moves');

  constructor() {
    const canvas = must<HTMLCanvasElement>('game');
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas, this.renderer, this);

    const select = must<HTMLSelectElement>('bar-select');
    for (const b of BARS) {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.name;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => this.switchBar(select.value));
    must<HTMLButtonElement>('btn-reset').addEventListener('click', () => this.restart());
    this.btnRetry.addEventListener('click', () => this.retry());
    must<HTMLButtonElement>('btn-restart').addEventListener('click', () => this.restart());

    this.model = new GameModel(BARS[0], DEFAULT_TRAY);
    this.rebuild();
  }

  // ---- physics / loop ----

  private rebuild(): void {
    this.sim.build(this.model);
    const p = this.sim.barPose();
    this.prevPose = { ...p };
    this.currPose = { ...p };
    this.acc = 0;
    this.tiltSteps = 0;
    this.hand = null;
    this.failed = false;
    this.overlay.classList.add('hidden');
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  private frame = (t: number): void => {
    if (this.lastT == null) this.lastT = t;
    this.acc += Math.min((t - this.lastT) / 1000, PHYS.maxAccum);
    this.lastT = t;
    while (this.acc >= PHYS.dt) {
      this.stepOnce();
      this.acc -= PHYS.dt;
    }
    const a = this.acc / PHYS.dt;
    const pose: Pose = {
      x: this.prevPose.x + (this.currPose.x - this.prevPose.x) * a,
      y: this.prevPose.y + (this.currPose.y - this.prevPose.y) * a,
      angle: this.prevPose.angle + (this.currPose.angle - this.prevPose.angle) * a,
    };
    this.renderer.draw(this.buildFrame(pose));
    this.updateHud();
    requestAnimationFrame(this.frame);
  };

  private stepOnce(): void {
    this.prevPose = this.currPose;
    this.sim.step();
    this.currPose = this.sim.barPose();
    this.checkFail();
  }

  /** Deterministically advance the sim (debug/testing helper, bypasses rAF). */
  advance(seconds: number): void {
    const n = Math.round(seconds / PHYS.dt);
    for (let i = 0; i < n; i++) this.stepOnce();
  }

  private checkFail(): void {
    if (this.failed) return;
    const p = this.currPose;
    this.tiltSteps = Math.abs(p.angle) > FAIL.tiltAngle ? this.tiltSteps + 1 : 0;
    if (this.tiltSteps >= FAIL.debounceSteps || p.y < FAIL.minY || Math.abs(p.x) > FAIL.maxX) {
      this.fail();
    }
  }

  private fail(): void {
    this.failed = true;
    this.hand = null; // held plates come back via retry's snapshot restore
    this.sim.releasePlates(this.model); // plates unweld and slide as the bar goes
    this.btnRetry.style.display = this.preMove ? '' : 'none';
    this.overlay.classList.remove('hidden');
  }

  /** Loose-plate poses during a drop (also used by headless tests). */
  loosePlates(): LoosePose[] {
    return this.sim.loosePoses();
  }

  // ---- GameHooks (called by Input) ----

  barPose(): Pose {
    return this.currPose;
  }

  private heldKg(): number {
    return this.hand?.plates.reduce((a, p) => a + p.kg, 0) ?? 0;
  }

  private ensureHand(): Hand {
    if (!this.hand) {
      this.preMove = this.model.snapshot();
      this.hand = { plates: [], world: { x: 0, y: 0.6 }, ghost: null };
    }
    return this.hand;
  }

  private fitsHand(kg: number): boolean {
    return !this.hand || this.heldKg() + kg <= CARRY_CAPACITY_KG + 1e-9;
  }

  grabFromTray(kg: number): void {
    if (this.failed || this.model.trayCount(kg) <= 0) return;
    if (!this.fitsHand(kg)) {
      this.flashOverCapacity();
      return;
    }
    const hand = this.ensureHand();
    this.model.trayTake(kg);
    hand.plates.push({ kg, from: { type: 'tray' } });
  }

  grabFromBar(side: Side): void {
    if (this.failed) return;
    const peek = this.model.outermost(side);
    if (!peek) return;
    if (!this.fitsHand(peek.kg)) {
      this.flashOverCapacity();
      return;
    }
    const hand = this.ensureHand();
    const p = this.model.detachOutermost(side);
    if (!p) return;
    this.sim.detachPlate(side);
    hand.plates.push({ kg: p.kg, from: { type: 'bar', side, offset: p.offset } });
  }

  /** Slide the whole hand stack onto `side`, packed flush from `offset` outward. */
  placeHand(side: Side, offset: number): void {
    const hand = this.hand;
    if (!hand || hand.plates.length === 0 || this.failed) return;
    const order = [...hand.plates].reverse(); // first grabbed lands outermost
    const total = order.reduce((a, p) => a + plateSpec(p.kg).width, 0);
    const range = this.model.validRange(side, total);
    if (!range || offset < range.min - 1e-9 || offset > range.max + 1e-9) return;
    let o = offset;
    for (const p of order) {
      this.model.attach(side, p.kg, o);
      this.sim.attachPlate(this.model, side, p.kg, o);
      o += plateSpec(p.kg).width;
    }
    this.finishHand();
  }

  dropHandToTray(): void {
    const hand = this.hand;
    if (!hand || this.failed) return;
    for (const p of hand.plates) this.model.trayPut(p.kg);
    this.finishHand();
  }

  cancelHand(): void {
    const hand = this.hand;
    if (!hand || this.failed) return;
    for (const p of [...hand.plates].reverse()) {
      if (p.from.type === 'tray') {
        this.model.trayPut(p.kg);
      } else {
        this.model.attach(p.from.side, p.kg, p.from.offset);
        this.sim.attachPlate(this.model, p.from.side, p.kg, p.from.offset);
      }
    }
    this.hand = null;
  }

  private finishHand(): void {
    this.hand = null;
    if (this.preMove && !this.model.equalsState(this.preMove)) this.model.moves++;
    // preMove is kept: it is the retry point (state before this move)
  }

  flashOverCapacity(): void {
    this.overCapUntil = performance.now() + 500;
  }

  // ---- buttons ----

  retry(): void {
    if (this.preMove) this.model.restore(this.preMove);
    this.rebuild();
  }

  restart(): void {
    this.model = new GameModel(this.model.bar, DEFAULT_TRAY);
    this.preMove = null;
    this.rebuild();
  }

  switchBar(id: string): void {
    const bar = BARS.find((b) => b.id === id) ?? BARS[0];
    this.model = new GameModel(bar, DEFAULT_TRAY);
    this.preMove = null;
    this.rebuild();
  }

  // ---- presentation ----

  private predictedComX(): number | null {
    const hand = this.hand;
    if (!hand?.ghost?.valid) return null;
    const g = hand.ghost;
    const extras: { side: Side; kg: number; offset: number }[] = [];
    let o = g.offset;
    for (const p of [...hand.plates].reverse()) {
      extras.push({ side: g.side, kg: p.kg, offset: o });
      o += plateSpec(p.kg).width;
    }
    return this.model.comX(extras);
  }

  private buildFrame(pose: Pose): FrameInfo {
    return {
      model: this.model,
      pose,
      hand: this.hand,
      hover: this.input.hover,
      comX: this.model.comX(),
      predictedComX: this.predictedComX(),
      failed: this.failed,
      loosePlates: this.failed ? this.sim.loosePoses() : null,
      overCapacityFlash: performance.now() < this.overCapUntil,
    };
  }

  private updateHud(): void {
    this.stTotal.textContent = `${fmtKg(this.model.totalMass())} kg`;
    this.stLeft.textContent = `${fmtKg(this.model.sideMass('L'))} kg`;
    this.stRight.textContent = `${fmtKg(this.model.sideMass('R'))} kg`;
    this.stMoves.textContent = String(this.model.moves);

    const f = this.model.tipFraction();
    const pct = Math.round(Math.abs(f) * 100);
    this.stBalance.textContent =
      pct === 0 ? 'even' : `${f < 0 ? '◀' : '▶'} ${pct}%`;
    this.stBalance.className =
      'value ' + (this.failed || pct >= 100 ? 'danger' : pct >= 60 ? 'warn' : 'ok');

    const carrying = this.heldKg();
    this.stCarry.textContent = `${fmtKg(carrying)} / ${CARRY_CAPACITY_KG} kg`;
    this.stCarry.className =
      'value' + (performance.now() < this.overCapUntil ? ' danger' : carrying > 0 ? ' ok' : '');
  }
}
