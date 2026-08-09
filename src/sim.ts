import RAPIER from '@dimforge/rapier2d-compat';
import type {
  Collider,
  ImpulseJoint,
  PrismaticImpulseJoint,
  RigidBody,
  World,
} from '@dimforge/rapier2d-compat';
import { PHYS, RACK, Side, plateSpec } from './config';
import type { GameModel } from './model';

let rapierReady: Promise<unknown> | null = null;

export function initPhysics(): Promise<unknown> {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

export interface Pose {
  x: number;
  y: number;
  angle: number;
}

/** World-space pose of a plate that has come loose during a drop. */
export interface LoosePose {
  kg: number;
  x: number;
  y: number;
  angle: number;
}

/**
 * Rapier world mirroring the GameModel. The bar is one dynamic body; attached
 * plates are extra colliders on that body (their mass shifts the bar's CoM and
 * inertia — tipping is emergent, never scripted). The bar merely RESTS on two
 * static hook seats; held plates have no body at all (weightless in hand).
 */
export class Sim {
  private world: World | null = null;
  private barBody!: RigidBody;
  private plateCols: { L: Collider[]; R: Collider[] } = { L: [], R: [] };
  private loose: { kg: number; body: RigidBody; joint: ImpulseJoint | null }[] = [];
  private barHalfLen = 0;

  /** Rebuild the whole world from the model (bar starts seated on the hooks). */
  build(model: GameModel): void {
    this.world?.free();
    this.world = new RAPIER.World({ x: 0, y: PHYS.gravity });
    this.world.timestep = PHYS.dt;
    this.plateCols = { L: [], R: [] };
    this.loose = [];
    this.barHalfLen = model.bar.length / 2;

    const statics = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(5, 0.1)
        .setTranslation(0, -0.1)
        .setFriction(0.7)
        .setRestitution(0.25),
      statics,
    );
    for (const sx of [-model.bar.hookHalfSpan, model.bar.hookHalfSpan]) {
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(RACK.seatHalfW, RACK.seatHalfH)
          .setTranslation(sx, RACK.hookTopY - RACK.seatHalfH)
          .setFriction(0.9)
          .setRestitution(0.05),
        statics,
      );
    }

    const bar = model.bar;
    this.barBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, RACK.hookTopY + bar.shaftRadius + 0.001)
        .setCcdEnabled(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(bar.length / 2, bar.shaftRadius)
        .setMass(bar.mass)
        .setFriction(0.9)
        .setRestitution(0.1),
      this.barBody,
    );

    for (const side of ['L', 'R'] as Side[]) {
      for (const p of model.sleeve(side)) this.attachPlate(model, side, p.kg, p.offset);
    }
  }

  attachPlate(model: GameModel, side: Side, kg: number, offset: number): void {
    if (!this.world) throw new Error('sim not built');
    const spec = plateSpec(kg);
    const lx = model.localX(side, kg, offset);
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(spec.width / 2, spec.diameter / 2)
        .setTranslation(lx, 0)
        .setMass(kg)
        .setFriction(0.8)
        .setRestitution(0.1),
      this.barBody,
    );
    this.plateCols[side].push(col);
    this.barBody.wakeUp();
  }

  /**
   * Re-seat a sleeve's colliders after a slide. Moving a collider on the bar
   * body shifts the body's CoM and inertia with it, so a shove retips the bar.
   */
  syncPlates(model: GameModel, side: Side): void {
    const plates = model.sleeve(side);
    const cols = this.plateCols[side];
    for (let i = 0; i < plates.length && i < cols.length; i++) {
      cols[i].setTranslationWrtParent({
        x: model.localX(side, plates[i].kg, plates[i].offset),
        y: 0,
      });
    }
    this.barBody.wakeUp();
  }

  /** Remove the outermost plate collider on `side` (mirrors GameModel pops). */
  detachPlate(side: Side): void {
    if (!this.world) return;
    const col = this.plateCols[side].pop();
    if (col) this.world.removeCollider(col, true);
    this.barBody.wakeUp();
  }

  /**
   * A drop has started: unweld every plate into its own body constrained to
   * slide along the bar axis (prismatic joint). The sleeve shoulder is the
   * inner stop; a plate whose centre passes the bar end slides clean off and
   * flies free. Called once when the level fails.
   */
  releasePlates(model: GameModel): void {
    if (!this.world || this.loose.length > 0) return;
    const bp = { ...this.barBody.translation() };
    const ang = this.barBody.rotation();
    const lv = { ...this.barBody.linvel() };
    const av = this.barBody.angvel();
    // linvel is the velocity of the CENTRE OF MASS, so that is the reference
    // point for v = v_com + w x r. A loaded bar's CoM sits out under the plates,
    // far from the body origin; using the origin here hands every plate a
    // spurious w x (com - origin), and the reaction launches the bar.
    const com = { ...this.barBody.worldCom() };
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    for (const side of ['L', 'R'] as Side[]) {
      const plates = model.sleeve(side);
      const cols = this.plateCols[side];
      for (let i = 0; i < plates.length; i++) {
        const p = plates[i];
        const spec = plateSpec(p.kg);
        const lx = model.localX(side, p.kg, p.offset);
        if (cols[i]) this.world.removeCollider(cols[i], true);
        const wx = bp.x + c * lx;
        const wy = bp.y + s * lx;
        const body = this.world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(wx, wy)
            .setRotation(ang)
            .setLinvel(lv.x - av * (wy - com.y), lv.y + av * (wx - com.x))
            .setAngvel(av)
            .setCcdEnabled(true),
        );
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(spec.width / 2, spec.diameter / 2)
            .setMass(p.kg)
            .setFriction(0.4)
            .setRestitution(0.15),
          body,
        );
        const data = RAPIER.JointData.prismatic({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 });
        data.limitsEnabled = true;
        const innerStop = model.sleeveStart() + spec.width / 2;
        data.limits =
          side === 'R' ? [innerStop, this.barHalfLen + 1] : [-this.barHalfLen - 1, -innerStop];
        const joint = this.world.createImpulseJoint(data, this.barBody, body, true);
        joint.setContactsEnabled(false);
        (joint as PrismaticImpulseJoint).configureMotorVelocity(0, 2); // light viscous drag
        this.loose.push({ kg: p.kg, body, joint });
      }
    }
    this.plateCols = { L: [], R: [] };
    this.barBody.wakeUp();
  }

  /** Free any loose plate whose centre slid past the end of the bar. */
  private maybeReleaseLoose(): void {
    if (!this.world || this.loose.length === 0) return;
    const bp = this.barBody.translation();
    const a = this.barBody.rotation();
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (const lp of this.loose) {
      if (!lp.joint) continue;
      const pt = lp.body.translation();
      const lx = c * (pt.x - bp.x) + s * (pt.y - bp.y);
      if (Math.abs(lx) > this.barHalfLen) {
        this.world.removeImpulseJoint(lp.joint, true);
        lp.joint = null;
      }
    }
  }

  step(): void {
    this.world?.step();
    this.maybeReleaseLoose();
  }

  barPose(): Pose {
    const t = this.barBody.translation();
    return { x: t.x, y: t.y, angle: this.barBody.rotation() };
  }

  loosePoses(): LoosePose[] {
    return this.loose.map((lp) => {
      const t = lp.body.translation();
      return { kg: lp.kg, x: t.x, y: t.y, angle: lp.body.rotation() };
    });
  }
}
