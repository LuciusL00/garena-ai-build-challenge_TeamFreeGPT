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
  /** Minimum straightness angle for the index finger. */
  readonly indexExtendedAngleDeg: number;
  /** Maximum PIP angle for middle, ring and little fingers. */
  readonly curledFingerAngleDeg: number;
  /** Exponential smoothing weight applied to each new observation. */
  readonly smoothingAlpha: number;
  /** Mirror horizontal output when using a mirrored front-camera preview. */
  readonly mirrorX: boolean;
}

export const DEFAULT_POINT_DIRECTION_CONFIG: PointDirectionConfig = {
  indexExtendedAngleDeg: 155,
  curledFingerAngleDeg: 135,
  smoothingAlpha: 0.35,
  mirrorX: true,
};

const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_TIP = 16;
const LITTLE_MCP = 17;
const LITTLE_PIP = 18;
const LITTLE_TIP = 20;
const REQUIRED_LANDMARK_COUNT = 21;

export class PointDirectionTracker {
  private smoothed: DirectionVector | null = null;

  public constructor(
    private readonly config: PointDirectionConfig = DEFAULT_POINT_DIRECTION_CONFIG,
  ) {
    if (config.smoothingAlpha <= 0 || config.smoothingAlpha > 1) {
      throw new Error('smoothingAlpha must be greater than 0 and at most 1.');
    }
  }

  /** Returns null unless the hand is in a pointing pose. */
  public update(landmarks: readonly HandLandmark[]): DirectionVector | null {
    if (landmarks.length < REQUIRED_LANDMARK_COUNT || !this.isPointingPose(landmarks)) {
      this.smoothed = null;
      return null;
    }

    const mcp = landmarks[INDEX_MCP];
    const tip = landmarks[INDEX_TIP];
    const raw = normalize({
      x: (tip.x - mcp.x) * (this.config.mirrorX ? -1 : 1),
      // Screen-space Y grows downward, which is the desired game-space convention.
      y: tip.y - mcp.y,
    });
    if (!raw) return null;

    if (!this.smoothed) {
      this.smoothed = raw;
      return raw;
    }

    const alpha = this.config.smoothingAlpha;
    const next = normalize({
      x: this.smoothed.x * (1 - alpha) + raw.x * alpha,
      y: this.smoothed.y * (1 - alpha) + raw.y * alpha,
    });
    this.smoothed = next;
    return next;
  }

  public reset(): void {
    this.smoothed = null;
  }

  private isPointingPose(landmarks: readonly HandLandmark[]): boolean {
    const indexAngle = jointAngle(
      landmarks[INDEX_MCP],
      landmarks[INDEX_PIP],
      landmarks[INDEX_TIP],
    );
    if (indexAngle < this.config.indexExtendedAngleDeg) return false;

    const curledAngles = [
      jointAngle(landmarks[MIDDLE_MCP], landmarks[MIDDLE_PIP], landmarks[MIDDLE_TIP]),
      jointAngle(landmarks[RING_MCP], landmarks[RING_PIP], landmarks[RING_TIP]),
      jointAngle(landmarks[LITTLE_MCP], landmarks[LITTLE_PIP], landmarks[LITTLE_TIP]),
    ];
    return curledAngles.every((angle) => angle <= this.config.curledFingerAngleDeg);
  }
}

function jointAngle(a: HandLandmark, joint: HandLandmark, c: HandLandmark): number {
  const first = { x: a.x - joint.x, y: a.y - joint.y, z: a.z - joint.z };
  const second = { x: c.x - joint.x, y: c.y - joint.y, z: c.z - joint.z };
  const firstLength = Math.hypot(first.x, first.y, first.z);
  const secondLength = Math.hypot(second.x, second.y, second.z);
  if (firstLength < Number.EPSILON || secondLength < Number.EPSILON) return 0;

  const cosine =
    (first.x * second.x + first.y * second.y + first.z * second.z) /
    (firstLength * secondLength);
  return (Math.acos(clamp(cosine, -1, 1)) * 180) / Math.PI;
}

function normalize(vector: DirectionVector): DirectionVector | null {
  const length = Math.hypot(vector.x, vector.y);
  if (length < Number.EPSILON) return null;
  return { x: vector.x / length, y: vector.y / length };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
