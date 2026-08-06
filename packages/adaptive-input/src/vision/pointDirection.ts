export interface HandLandmark {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface DirectionVector {
  readonly x: number;
  readonly y: number;
}

export interface PointDirectionConfig {
  readonly lossGraceMs: number;
  readonly directionDeadZoneDeg: number;
  readonly smoothingAlpha: number;
}

export const DEFAULT_POINT_DIRECTION_CONFIG: PointDirectionConfig = {
  lossGraceMs: 180,
  directionDeadZoneDeg: 4,
  smoothingAlpha: 0.35,
};

const ENTER_INDEX_ANGLE_DEG = 155;
const ENTER_FOLDED_ANGLE_DEG = 135;
const HOLD_INDEX_ANGLE_DEG = 145;
const HOLD_FOLDED_ANGLE_DEG = 145;

const FINGERS = [
  [9, 10, 12],
  [13, 14, 16],
  [17, 18, 20],
] as const;

export class PointDirectionTracker {
  private filtered: DirectionVector | null = null;
  private output: DirectionVector | null = null;
  private lastObservedAt: number | null = null;

  constructor(
    private readonly config: PointDirectionConfig = DEFAULT_POINT_DIRECTION_CONFIG,
  ) {
    if (!Number.isFinite(config.lossGraceMs) || config.lossGraceMs < 0) {
      throw new RangeError('lossGraceMs must be a finite non-negative number.');
    }
    if (
      !Number.isFinite(config.directionDeadZoneDeg) ||
      config.directionDeadZoneDeg < 0 ||
      config.directionDeadZoneDeg > 180
    ) {
      throw new RangeError('directionDeadZoneDeg must be between 0 and 180.');
    }
    if (
      !Number.isFinite(config.smoothingAlpha) ||
      config.smoothingAlpha <= 0 ||
      config.smoothingAlpha > 1
    ) {
      throw new RangeError('smoothingAlpha must be greater than 0 and at most 1.');
    }
  }

  get isActive(): boolean {
    return this.output !== null;
  }

  /** The preview is mirrored, so model-space right becomes player-space left. */
  update(landmarks: readonly HandLandmark[], timestamp: number): DirectionVector | null {
    const observed = landmarks.length >= 21 && this.isPointing(landmarks, this.isActive);
    if (!observed) return this.holdOrEnd(timestamp);

    const base = landmarks[5];
    const tip = landmarks[8];
    const raw = normalize({ x: -(tip.x - base.x), y: tip.y - base.y });
    if (!raw) return this.holdOrEnd(timestamp);
    const next = this.filtered
      ? normalize({
          x: this.filtered.x * (1 - this.config.smoothingAlpha) + raw.x * this.config.smoothingAlpha,
          y: this.filtered.y * (1 - this.config.smoothingAlpha) + raw.y * this.config.smoothingAlpha,
        })
      : raw;
    if (!next) return this.holdOrEnd(timestamp);
    this.filtered = next;
    this.lastObservedAt = timestamp;
    if (
      this.output !== null &&
      angularDistanceDeg(this.output, next) < this.config.directionDeadZoneDeg
    ) {
      return this.output;
    }
    this.output = next;
    return this.output;
  }

  reset(): void {
    this.filtered = null;
    this.output = null;
    this.lastObservedAt = null;
  }

  private holdOrEnd(timestamp: number): DirectionVector | null {
    if (
      this.output !== null &&
      this.lastObservedAt !== null &&
      timestamp - this.lastObservedAt <= this.config.lossGraceMs
    ) {
      return this.output;
    }
    this.reset();
    return null;
  }

  private isPointing(landmarks: readonly HandLandmark[], holding: boolean): boolean {
    const indexMinimum = holding ? HOLD_INDEX_ANGLE_DEG : ENTER_INDEX_ANGLE_DEG;
    const foldedMaximum = holding ? HOLD_FOLDED_ANGLE_DEG : ENTER_FOLDED_ANGLE_DEG;
    if (jointAngle(landmarks[5], landmarks[6], landmarks[8]) < indexMinimum) return false;
    return FINGERS.every(([mcp, pip, tip]) =>
      jointAngle(landmarks[mcp], landmarks[pip], landmarks[tip]) <= foldedMaximum,
    );
  }
}

function jointAngle(a: HandLandmark, b: HandLandmark, c: HandLandmark): number {
  const ab = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const cb = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const denominator = Math.hypot(ab.x, ab.y, ab.z) * Math.hypot(cb.x, cb.y, cb.z);
  if (denominator < Number.EPSILON) return 0;
  const cosine = (ab.x * cb.x + ab.y * cb.y + ab.z * cb.z) / denominator;
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

function normalize(vector: DirectionVector): DirectionVector | null {
  const length = Math.hypot(vector.x, vector.y);
  return length < Number.EPSILON ? null : { x: vector.x / length, y: vector.y / length };
}

function angularDistanceDeg(left: DirectionVector, right: DirectionVector): number {
  const dot = left.x * right.x + left.y * right.y;
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}
