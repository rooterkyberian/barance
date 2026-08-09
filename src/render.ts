import {
  CARRY_CAPACITY_KG,
  PLATE_LIST,
  PlateSpec,
  RACK,
  Side,
  TRAY_SLOT_X,
  plateSpec,
} from './config';
import type { GameModel } from './model';
import type { LoosePose, Pose } from './sim';
import type { Hand, HoverState } from './input';

export interface FrameInfo {
  model: GameModel;
  pose: Pose;
  hand: Hand | null;
  hover: HoverState;
  comX: number;
  predictedComX: number | null;
  failed: boolean;
  loosePlates: LoosePose[] | null;
  overCapacityFlash: boolean;
}

const W = 1280;
const H = 720;
const S = 376; // px per metre
const CX = W / 2;
const CY = 697; // screen y of world y=0

const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';

export function fmtKg(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr: number;

  constructor(private canvas: HTMLCanvasElement) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * this.dpr;
    canvas.height = H * this.dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
  }

  w2s(x: number, y: number): [number, number] {
    return [CX + x * S, CY - y * S];
  }

  s2w(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - CX) / S, y: (CY - sy) / S };
  }

  eventToWorld(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const sx = ((e.clientX - r.left) * W) / r.width;
    const sy = ((e.clientY - r.top) * H) / r.height;
    return this.s2w(sx, sy);
  }

  /** Axis-aligned world-space rect; (x, yBottom) is the bottom-left corner. */
  private rectW(
    x: number,
    yBottom: number,
    w: number,
    h: number,
    fill: string,
    stroke?: string,
    lw = 1.5,
  ): void {
    const [sx, sy] = this.w2s(x, yBottom + h);
    this.ctx.fillStyle = fill;
    this.ctx.fillRect(sx, sy, w * S, h * S);
    if (stroke) {
      this.ctx.strokeStyle = stroke;
      this.ctx.lineWidth = lw;
      this.ctx.strokeRect(sx, sy, w * S, h * S);
    }
  }

  private text(
    s: string,
    x: number,
    y: number,
    font: string,
    color: string,
    align: CanvasTextAlign = 'center',
  ): void {
    const [sx, sy] = this.w2s(x, y);
    this.ctx.font = font;
    this.ctx.fillStyle = color;
    this.ctx.textAlign = align;
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(s, sx, sy);
  }

  draw(f: FrameInfo): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    ctx.fillStyle = '#14161a';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#232730';
    ctx.fillRect(0, CY, W, H - CY);
    ctx.fillStyle = '#3a4150';
    ctx.fillRect(0, CY - 1, W, 2);

    this.drawRackBack(f.model);
    this.drawGauge(f);
    this.drawTray(f);
    this.drawBarAssembly(f);
    if (f.loosePlates) this.drawLoosePlates(f.loosePlates);
    this.drawRackFront(f.model);
    this.drawSideLoads(f.model);
    this.drawHand(f);

    if (f.failed) {
      ctx.fillStyle = 'rgba(8, 9, 12, 0.25)';
      ctx.fillRect(0, 0, W, H);
    }
  }

  private drawRackBack(model: GameModel): void {
    const { ctx } = this;
    for (const s of [-1, 1]) {
      const x = s * model.bar.hookHalfSpan;
      this.rectW(x - RACK.uprightHalfW, 0, RACK.uprightHalfW * 2, RACK.uprightTopY, '#262b33');
      ctx.fillStyle = '#171b21';
      for (let y = 0.16; y < RACK.uprightTopY - 0.06; y += 0.12) {
        const [hx, hy] = this.w2s(x, y);
        ctx.beginPath();
        ctx.arc(hx, hy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      this.rectW(
        x - RACK.seatHalfW,
        RACK.hookTopY - RACK.seatHalfH * 2,
        RACK.seatHalfW * 2,
        RACK.seatHalfH * 2,
        '#4a5262',
      );
    }
  }

  /** Small lip drawn over the bar so it reads as sitting IN the J-hook. */
  private drawRackFront(model: GameModel): void {
    for (const s of [-1, 1]) {
      const x = s * model.bar.hookHalfSpan;
      this.rectW(x - RACK.seatHalfW, RACK.hookTopY - 0.012, RACK.seatHalfW * 2, 0.032, '#5a6375');
    }
  }

  private marker(x: number, d: number, gy: number, filled: boolean): void {
    const { ctx } = this;
    const f = x / (d + RACK.seatHalfW); // true pivot is the seat's outer edge
    const color =
      Math.abs(f) < 0.6 ? '#59c169' : Math.abs(f) < 0.9 ? '#e0a93c' : '#e05252';
    const cl = Math.max(-d * 1.18, Math.min(d * 1.18, x));
    const [mx, my] = this.w2s(cl, gy);
    ctx.beginPath();
    ctx.moveTo(mx, my - 3);
    ctx.lineTo(mx - 7, my - 15);
    ctx.lineTo(mx + 7, my - 15);
    ctx.closePath();
    if (filled) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  private drawGauge(f: FrameInfo): void {
    const { ctx } = this;
    const d = f.model.bar.hookHalfSpan;
    const gy = 1.52;
    const [x0, y0] = this.w2s(-d, gy);
    const [x1] = this.w2s(d, gy);
    ctx.strokeStyle = '#3a4150';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.stroke();
    for (const tx of [-d, 0, d]) {
      const [sx] = this.w2s(tx, gy);
      ctx.strokeStyle = tx === 0 ? '#333a45' : '#4a5262';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, y0 - 5);
      ctx.lineTo(sx, y0 + 5);
      ctx.stroke();
    }
    this.text('BALANCE', 0, gy + 0.075, `10px ${FONT}`, '#5f6874');
    if (f.predictedComX != null) this.marker(f.predictedComX, d, gy, false);
    this.marker(f.comX, d, gy, true);
  }

  private drawBarAssembly(f: FrameInfo): void {
    const { ctx } = this;
    const { model, pose, hand, hover } = f;
    const bar = model.bar;
    const s0 = model.sleeveStart();
    const [bx, by] = this.w2s(pose.x, pose.y);

    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(S, -S);
    ctx.rotate(pose.angle);

    ctx.fillStyle = '#b6bcc6';
    ctx.fillRect(-bar.length / 2, -bar.shaftRadius, bar.length, bar.shaftRadius * 2);
    ctx.fillStyle = '#c9cfd8';
    for (const s of [-1, 1]) {
      const x = s === 1 ? s0 : -s0 - bar.sleeveLength;
      ctx.fillRect(x, -bar.sleeveRadius, bar.sleeveLength, bar.sleeveRadius * 2);
    }
    ctx.fillStyle = '#d7dce3';
    for (const s of [-1, 1]) {
      const w = 0.02;
      const x = s === 1 ? s0 - w : -s0;
      ctx.fillRect(x, -0.058, w, 0.116);
    }

    let slideTrack: { side: Side; index: number; spec: PlateSpec } | null = null;
    for (const side of f.loosePlates ? [] : (['L', 'R'] as Side[])) {
      const plates = model.sleeve(side);
      for (let i = 0; i < plates.length; i++) {
        const p = plates[i];
        const spec = plateSpec(p.kg);
        const cx = model.localX(side, p.kg, p.offset);
        ctx.fillStyle = spec.color;
        ctx.fillRect(cx - spec.width / 2, -spec.diameter / 2, spec.width, spec.diameter);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1.5 / S;
        ctx.strokeRect(cx - spec.width / 2, -spec.diameter / 2, spec.width, spec.diameter);
        const isHoverGrab =
          hover.barSide === side && i === plates.length - 1 && hover.canGrab && !f.failed;
        const isHoverSlide = hover.slide?.side === side && hover.slide.index === i && !f.failed;
        if (isHoverGrab || isHoverSlide) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.5 / S;
          if (isHoverSlide) ctx.setLineDash([0.022, 0.015]);
          ctx.strokeRect(cx - spec.width / 2, -spec.diameter / 2, spec.width, spec.diameter);
          ctx.setLineDash([]);
        }
        if (isHoverSlide) slideTrack = { side, index: i, spec };
      }
    }

    if (slideTrack) {
      const { side, index, spec } = slideTrack;
      const b = model.slideBounds(side, index);
      const sgn = side === 'L' ? -1 : 1;
      const y = -(spec.diameter / 2 + 0.04);
      const from = sgn * (s0 + b.min);
      const to = sgn * (s0 + b.max + spec.width);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.5 / S;
      ctx.beginPath();
      ctx.moveTo(from, y);
      ctx.lineTo(to, y);
      for (const x of [from, to]) {
        ctx.moveTo(x, y - 0.02);
        ctx.lineTo(x, y + 0.02);
      }
      ctx.stroke();
    }

    if (hand?.ghost) {
      const g = hand.ghost;
      const sgn = g.side === 'L' ? -1 : 1;
      const order = [...hand.plates].reverse();
      let o = g.offset;
      let total = 0;
      let maxD = 0;
      ctx.globalAlpha = 0.5;
      for (const p of order) {
        const spec = plateSpec(p.kg);
        const cx = sgn * (s0 + o + spec.width / 2);
        ctx.fillStyle = spec.color;
        ctx.fillRect(cx - spec.width / 2, -spec.diameter / 2, spec.width, spec.diameter);
        o += spec.width;
        total += spec.width;
        maxD = Math.max(maxD, spec.diameter);
      }
      ctx.globalAlpha = 1;
      const u0 = s0 + g.offset;
      const xA = sgn === 1 ? u0 : -(u0 + total);
      ctx.strokeStyle = g.valid ? 'rgba(120, 220, 130, 0.95)' : 'rgba(230, 90, 90, 0.95)';
      ctx.lineWidth = 2.5 / S;
      ctx.strokeRect(xA, -maxD / 2, total, maxD);
    }

    ctx.restore();
  }

  /** Plates that came loose during a drop — drawn at their own body poses. */
  private drawLoosePlates(loose: LoosePose[]): void {
    const { ctx } = this;
    for (const lp of loose) {
      const spec = plateSpec(lp.kg);
      const [px, py] = this.w2s(lp.x, lp.y);
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(S, -S);
      ctx.rotate(lp.angle);
      ctx.fillStyle = spec.color;
      ctx.fillRect(-spec.width / 2, -spec.diameter / 2, spec.width, spec.diameter);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5 / S;
      ctx.strokeRect(-spec.width / 2, -spec.diameter / 2, spec.width, spec.diameter);
      ctx.restore();
    }
  }

  private drawSideLoads(model: GameModel): void {
    const bar = model.bar;
    const x = model.sleeveStart() + bar.sleeveLength / 2;
    this.text(`${fmtKg(model.sideMass('L'))} kg`, -x, 1.3, `600 15px ${FONT}`, '#8b93a0');
    this.text(`${fmtKg(model.sideMass('R'))} kg`, x, 1.3, `600 15px ${FONT}`, '#8b93a0');
  }

  private drawTray(f: FrameInfo): void {
    const { ctx } = this;
    const { model, hover, hand } = f;

    if (hand && hand.world.y < 0.55 && !hand.ghost) {
      const [sx, sy] = this.w2s(-1.66, 0.52);
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx, sy, 3.32 * S, 0.52 * S);
      ctx.setLineDash([]);
      this.text('set down', 0, 0.49, `11px ${FONT}`, '#6d7683');
    }

    for (let i = 0; i < PLATE_LIST.length; i++) {
      const spec = PLATE_LIST[i];
      const x = TRAY_SLOT_X[i];
      const count = model.trayCount(spec.kg);
      const n = Math.min(count, 4);
      if (count === 0) {
        const [sx, sy] = this.w2s(x - spec.width / 2 - 0.012, spec.diameter);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255,255,255,0.09)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx, sy, (spec.width + 0.024) * S, spec.diameter * S);
        ctx.setLineDash([]);
      } else {
        const pitch = spec.width + 0.008;
        for (let k = 0; k < n; k++) {
          const dx = (k - (n - 1) / 2) * pitch;
          this.rectW(
            x + dx - spec.width / 2,
            0,
            spec.width,
            spec.diameter,
            spec.color,
            'rgba(0,0,0,0.35)',
          );
        }
        if (hover.trayKg === spec.kg && hover.canGrab && !f.failed) {
          const gw = n * pitch + 0.012;
          const [sx, sy] = this.w2s(x - gw / 2, spec.diameter + 0.008);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.strokeRect(sx, sy, gw * S, (spec.diameter + 0.016) * S);
        }
      }
      const labelY = Math.max(spec.diameter, 0.2) + 0.05;
      this.text(`${spec.label} ×${count}`, x, labelY, `600 13px ${FONT}`, '#8f97a3');
    }
  }

  private drawHand(f: FrameInfo): void {
    const { ctx } = this;
    const hand = f.hand;
    if (!hand || hand.plates.length === 0) return;
    const order = [...hand.plates].reverse();
    const total = order.reduce((a, p) => a + plateSpec(p.kg).width, 0);
    const maxD = Math.max(...order.map((p) => plateSpec(p.kg).diameter));
    let ox = hand.world.x - total / 2;
    ctx.globalAlpha = 0.92;
    for (const p of order) {
      const spec = plateSpec(p.kg);
      this.rectW(ox, hand.world.y - spec.diameter / 2, spec.width, spec.diameter, spec.color, 'rgba(0,0,0,0.4)');
      ox += spec.width;
    }
    ctx.globalAlpha = 1;
    const kg = order.reduce((a, p) => a + p.kg, 0);
    this.text(
      `${fmtKg(kg)} / ${CARRY_CAPACITY_KG} kg`,
      hand.world.x,
      hand.world.y - maxD / 2 - 0.07,
      `600 13px ${FONT}`,
      f.overCapacityFlash ? '#ff5f5f' : '#cfd5dd',
    );
  }
}
