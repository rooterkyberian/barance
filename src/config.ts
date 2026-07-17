export type Side = 'L' | 'R';

export interface BarSpec {
  id: string;
  name: string;
  mass: number; // kg
  length: number; // m, end to end
  sleeveLength: number; // m, loadable length per side
  shaftRadius: number; // m
  sleeveRadius: number; // m, visual
  hookHalfSpan: number; // m, J-hooks sit at ±hookHalfSpan
}

export const BARS: BarSpec[] = [
  {
    id: 'mens',
    name: "Olympic men's — 20 kg",
    mass: 20,
    length: 2.2,
    sleeveLength: 0.415,
    shaftRadius: 0.014,
    sleeveRadius: 0.025,
    hookHalfSpan: 0.55,
  },
  {
    id: 'womens',
    name: "Olympic women's — 15 kg",
    mass: 15,
    length: 2.01,
    sleeveLength: 0.32,
    shaftRadius: 0.0125,
    sleeveRadius: 0.025,
    hookHalfSpan: 0.55,
  },
  {
    id: 'technique',
    name: 'Technique bar — 7 kg',
    mass: 7,
    length: 1.7,
    sleeveLength: 0.25,
    shaftRadius: 0.0125,
    sleeveRadius: 0.024,
    hookHalfSpan: 0.45,
  },
];

export interface PlateSpec {
  kg: number;
  width: number; // m, axial thickness
  diameter: number; // m
  color: string;
  label: string;
}

// IWF-style colors; widths/diameters approximate competition bumpers + change plates.
export const PLATE_LIST: PlateSpec[] = [
  { kg: 25, width: 0.064, diameter: 0.45, color: '#cc3b3b', label: '25' },
  { kg: 20, width: 0.054, diameter: 0.45, color: '#3566c4', label: '20' },
  { kg: 15, width: 0.043, diameter: 0.45, color: '#e6b83c', label: '15' },
  { kg: 10, width: 0.035, diameter: 0.45, color: '#3da35d', label: '10' },
  { kg: 5, width: 0.026, diameter: 0.228, color: '#e8eaed', label: '5' },
  { kg: 2.5, width: 0.019, diameter: 0.19, color: '#b84a4a', label: '2.5' },
  { kg: 1.25, width: 0.013, diameter: 0.16, color: '#a8b0ba', label: '1.25' },
];

export function plateSpec(kg: number): PlateSpec {
  const s = PLATE_LIST.find((p) => p.kg === kg);
  if (!s) throw new Error(`unknown plate: ${kg} kg`);
  return s;
}

export const DEFAULT_TRAY: ReadonlyArray<[number, number]> = PLATE_LIST.map((p) => [
  p.kg,
  p.kg === 25 ? 4 : 2,
]);

/** World x of each tray slot, index-aligned with PLATE_LIST. */
export const TRAY_SLOT_X: number[] = [-1.5, -1.0, -0.5, 0, 0.5, 1.0, 1.5];

/**
 * Max total kg the player may hold at once. A single plate is always carryable
 * (a lone 25 exceeds the cap but must still be movable); the cap gates adding
 * MORE plates to a non-empty hand.
 */
export const CARRY_CAPACITY_KG = 20;

export const RACK = {
  hookTopY: 1.0, // m, top surface of the J-hook seats
  seatHalfW: 0.045,
  seatHalfH: 0.03,
  uprightHalfW: 0.032,
  uprightTopY: 1.32,
};

export const PHYS = {
  dt: 1 / 120, // fixed timestep, s
  gravity: -9.81,
  maxAccum: 0.25, // s, clamp for tab-switch catchup
  snapGrid: 0.005, // m, plate placement quantization (determinism-friendly)
};

// Tilting past 15° counts as a drop; the sim keeps running so the fall
// animates, and at that moment plates unweld and start sliding on the sleeve.
export const FAIL = {
  tiltAngle: (15 * Math.PI) / 180,
  debounceSteps: 6, // consecutive steps past tiltAngle before failing
  minY: RACK.hookTopY - 0.2, // bar centre fell below the hooks
  maxX: 0.3, // bar slid way off-centre
};
