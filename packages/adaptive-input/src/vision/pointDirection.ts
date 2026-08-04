export interface HandLandmark {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface DirectionVector {
  readonly x: number;
  readonly y: number;
}

const FINGERS = [
  [9, 10, 12],
  [13, 14, 16],
  [17, 18, 20],
] as const;

export class PointDirectionTracker {
  private smoothed: DirectionVector | null = null;

  /** The preview is mirrored, so model-space right becomes player-space left. */
  update(landmarks: readonly HandLandmark[]): DirectionVector | null {
    if (landmarks.length < 21 || !this.isPointing(landmarks)) {
      this.reset();
      return null;
    }
    const base = landmarks[5];
    const tip = landmarks[8];
    const raw = normalize({ x: -(tip.x - base.x), y: tip.y - base.y });
    if (!raw) return null;
    const next = this.smoothed
      ? normalize({
          x: this.smoothed.x * 0.65 + raw.x * 0.35,
          y: this.smoothed.y * 0.65 + raw.y * 0.35,
        })
      : raw;
    this.smoothed = next;
    return next;
  }

  reset(): void {
    this.smoothed = null;
  }

  private isPointing(landmarks: readonly HandLandmark[]): boolean {
    if (jointAngle(landmarks[5], landmarks[6], landmarks[8]) < 155) return false;
    return FINGERS.every(([mcp, pip, tip]) =>
      jointAngle(landmarks[mcp], landmarks[pip], landmarks[tip]) <= 135,
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
