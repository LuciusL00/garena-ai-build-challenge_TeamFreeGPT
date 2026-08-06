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
  /** Hand no longer visible at all. */
  readonly lossGraceMs: number;
  /** Hand still visible but its pointing shape briefly became unclear. */
  readonly shapeGraceMs: number;
  /** A competing command pose must persist this long before it releases pointing. */
  readonly competingHoldMs: number;
  readonly directionDeadZoneDeg: number;
  readonly smoothingAlpha: number;
}

/** Player-facing pointing stability choices, in milliseconds of loss tolerance. */
export const POINT_STABILITY_STEPS_MS = [120, 180, 240, 300, 360] as const;
export const DEFAULT_POINT_STABILITY_MS = 180;
/** A visible hand carries more evidence than an absent one, so it waits longer. */
const SHAPE_GRACE_BONUS_MS = 120;
const COMPETING_HOLD_MS = 200;
/** Share of observed recognition gaps a recommended stability value must bridge. */
const GAP_COVERAGE = 0.9;

export const DEFAULT_POINT_DIRECTION_CONFIG: PointDirectionConfig = {
  lossGraceMs: DEFAULT_POINT_STABILITY_MS,
  shapeGraceMs: DEFAULT_POINT_STABILITY_MS + SHAPE_GRACE_BONUS_MS,
  competingHoldMs: COMPETING_HOLD_MS,
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

/** Derives the full timing set from one player-facing stability value. */
export function pointStabilityConfig(
  stabilityMs: number,
  base: PointDirectionConfig = DEFAULT_POINT_DIRECTION_CONFIG,
): PointDirectionConfig {
  if (!Number.isFinite(stabilityMs) || stabilityMs < 0) {
    throw new RangeError('Pointing stability must be a finite non-negative duration.');
  }
  return { ...base, lossGraceMs: stabilityMs, shapeGraceMs: stabilityMs + SHAPE_GRACE_BONUS_MS };
}

/**
 * Picks the shortest stability value that bridges most measured recognition gaps.
 * Gaps are raw detector dropouts, so a longer value trades stop latency for fewer
 * interruptions. With no measured gaps the shortest value is already sufficient.
 */
export function recommendPointStabilityMs(gapDurationsMs: readonly number[]): number {
  const steps = POINT_STABILITY_STEPS_MS;
  const longest = steps[steps.length - 1] ?? DEFAULT_POINT_STABILITY_MS;
  if (gapDurationsMs.length === 0) return steps[0] ?? DEFAULT_POINT_STABILITY_MS;
  const required = Math.ceil(gapDurationsMs.length * GAP_COVERAGE);
  return steps.find(
    (candidate) => gapDurationsMs.filter((gap) => gap <= candidate).length >= required,
  ) ?? longest;
}

export class PointDirectionTracker {
  private filtered: DirectionVector | null = null;
  private output: DirectionVector | null = null;
  private lastObservedAt: number | null = null;
  private competingSince: number | null = null;
  private shapeObserved = false;
  private config: PointDirectionConfig;

  constructor(config: PointDirectionConfig = DEFAULT_POINT_DIRECTION_CONFIG) {
    this.config = validatePointDirectionConfig(config);
  }

  get isActive(): boolean {
    return this.output !== null;
  }

  /** Raw per-frame shape recognition, before any grace period is applied. */
  get isShapeObserved(): boolean {
    return this.shapeObserved;
  }

  get stabilityMs(): number {
    return this.config.lossGraceMs;
  }

  setStabilityMs(stabilityMs: number): void {
    this.config = validatePointDirectionConfig(pointStabilityConfig(stabilityMs, this.config));
  }

  /**
   * The preview is mirrored, so model-space right becomes player-space left.
   *
   * `competing` reports that another command pose was recognized this frame. One
   * such frame is treated as an unclear frame, not as a release: only a competing
   * pose held for `competingHoldMs` ends pointing immediately.
   */
  update(
    landmarks: readonly HandLandmark[],
    timestamp: number,
    competing = false,
  ): DirectionVector | null {
    if (competing) {
      this.competingSince ??= timestamp;
      if (timestamp - this.competingSince >= this.config.competingHoldMs) {
        this.reset();
        return null;
      }
    } else {
      this.competingSince = null;
    }

    const handVisible = landmarks.length >= 21;
    this.shapeObserved = handVisible && this.isPointing(landmarks, this.isActive);
    if (!this.shapeObserved) return this.holdOrEnd(timestamp, handVisible);

    const base = landmarks[5];
    const tip = landmarks[8];
    const raw = normalize({ x: -(tip.x - base.x), y: tip.y - base.y });
    if (!raw) return this.holdOrEnd(timestamp, handVisible);
    const next = this.filtered
      ? normalize({
          x: this.filtered.x * (1 - this.config.smoothingAlpha) + raw.x * this.config.smoothingAlpha,
          y: this.filtered.y * (1 - this.config.smoothingAlpha) + raw.y * this.config.smoothingAlpha,
        })
      : raw;
    if (!next) return this.holdOrEnd(timestamp, handVisible);
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
    this.competingSince = null;
    this.shapeObserved = false;
  }

  private holdOrEnd(timestamp: number, handVisible: boolean): DirectionVector | null {
    const graceMs = handVisible ? this.config.shapeGraceMs : this.config.lossGraceMs;
    if (
      this.output !== null &&
      this.lastObservedAt !== null &&
      timestamp - this.lastObservedAt <= graceMs
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

function validatePointDirectionConfig(config: PointDirectionConfig): PointDirectionConfig {
  (['lossGraceMs', 'shapeGraceMs', 'competingHoldMs'] as const).forEach((name) => {
    const value = config[name];
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${name} must be a finite non-negative number.`);
    }
  });
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
  return config;
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
