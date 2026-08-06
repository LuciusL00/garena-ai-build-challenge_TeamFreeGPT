/** Persistent player calibration scores, keyed by neutral task and source. */

import type { CalibrationTask } from './actions.ts';
import type { ChannelScore } from './recommendation/types.ts';
import { InputChannelId, InputSourceId } from './sources.ts';

const PROFILE_VERSION = 2;
const DEFAULT_STORAGE_KEY = 'teamfreegpt.adaptive-input.profile.v2';
const VISION_TUNING_VERSION = 1;
const DEFAULT_VISION_TUNING_STORAGE_KEY = 'teamfreegpt.adaptive-input.vision-tuning.v1';

export const VISION_INFERENCE_FPS_OPTIONS = [10, 12, 15] as const;
export type VisionInferenceFps = typeof VISION_INFERENCE_FPS_OPTIONS[number];
export type VisionTriggerSource =
  | InputSourceId.HAND_CLOSED_FIST
  | InputSourceId.HAND_OPEN_PALM
  | InputSourceId.HAND_THUMB_UP;

const VISION_TRIGGER_SOURCES: readonly VisionTriggerSource[] = [
  InputSourceId.HAND_CLOSED_FIST,
  InputSourceId.HAND_OPEN_PALM,
  InputSourceId.HAND_THUMB_UP,
];

export interface VisionTuningPreferences {
  readonly inferenceFps: VisionInferenceFps;
  readonly gestureStabilityMs: Readonly<Partial<Record<VisionTriggerSource, number>>>;
}

export const DEFAULT_VISION_TUNING_PREFERENCES: VisionTuningPreferences = {
  inferenceFps: 15,
  gestureStabilityMs: {},
};

export interface CalibrationProfileSnapshot {
  version: typeof PROFILE_VERSION;
  scores: readonly ChannelScore[];
}

export interface ProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class CalibrationProfile {
  private readonly scores = new Map<string, ChannelScore>();

  constructor(initialScores: readonly ChannelScore[] = []) {
    initialScores.forEach((score) => this.save(score));
  }

  save(score: ChannelScore): void {
    this.scores.set(scoreKey(score.task, score.source), { ...score });
  }

  get(task: CalibrationTask, source: InputSourceId): ChannelScore | undefined {
    const score = this.scores.get(scoreKey(task, source));
    return score ? { ...score } : undefined;
  }

  getFresh(
    task: CalibrationTask,
    source: InputSourceId,
    maximumAgeMs: number,
    now: number = Date.now(),
  ): ChannelScore | undefined {
    if (maximumAgeMs < 0) throw new Error('maximumAgeMs cannot be negative.');
    const score = this.get(task, source);
    if (!score || now - score.recordedAt > maximumAgeMs) return undefined;
    return score;
  }

  all(): readonly ChannelScore[] {
    return [...this.scores.values()].map((score) => ({ ...score }));
  }

  snapshot(): CalibrationProfileSnapshot {
    return { version: PROFILE_VERSION, scores: this.all() };
  }
}

export class CalibrationProfileStore {
  constructor(
    private readonly storage: ProfileStorage,
    private readonly key: string = DEFAULT_STORAGE_KEY,
  ) {}

  load(): CalibrationProfile {
    const serialized = this.storage.getItem(this.key);
    if (!serialized) return new CalibrationProfile();

    try {
      const parsed: unknown = JSON.parse(serialized);
      return new CalibrationProfile(readScores(parsed));
    } catch {
      return new CalibrationProfile();
    }
  }

  save(profile: CalibrationProfile): void {
    this.storage.setItem(this.key, JSON.stringify(profile.snapshot()));
  }

  clear(): void {
    this.storage.removeItem(this.key);
  }
}

/** Device-local vision settings. Hosts may replace this store with native persistence. */
export class VisionTuningStore {
  constructor(
    private readonly storage: ProfileStorage,
    private readonly key: string = DEFAULT_VISION_TUNING_STORAGE_KEY,
  ) {}

  load(): VisionTuningPreferences {
    const serialized = this.storage.getItem(this.key);
    if (!serialized) return cloneVisionTuning(DEFAULT_VISION_TUNING_PREFERENCES);
    try {
      return readVisionTuning(JSON.parse(serialized));
    } catch {
      return cloneVisionTuning(DEFAULT_VISION_TUNING_PREFERENCES);
    }
  }

  save(preferences: VisionTuningPreferences): void {
    const validated = readVisionTuning({
      version: VISION_TUNING_VERSION,
      inferenceFps: preferences.inferenceFps,
      gestureStabilityMs: preferences.gestureStabilityMs,
    });
    this.storage.setItem(this.key, JSON.stringify({
      version: VISION_TUNING_VERSION,
      ...validated,
    }));
  }

  clear(): void {
    this.storage.removeItem(this.key);
  }
}

function scoreKey(task: CalibrationTask, source: InputSourceId): string {
  return `${task}:${source}`;
}

function readScores(value: unknown): readonly ChannelScore[] {
  if (!isRecord(value) || value.version !== PROFILE_VERSION || !Array.isArray(value.scores)) {
    return [];
  }
  return value.scores.filter(isChannelScore);
}

function readVisionTuning(value: unknown): VisionTuningPreferences {
  if (
    !isRecord(value) ||
    value.version !== VISION_TUNING_VERSION ||
    !isVisionInferenceFps(value.inferenceFps) ||
    !isRecord(value.gestureStabilityMs)
  ) {
    return cloneVisionTuning(DEFAULT_VISION_TUNING_PREFERENCES);
  }

  const savedStability = value.gestureStabilityMs;
  const gestureStabilityMs: Partial<Record<VisionTriggerSource, number>> = {};
  VISION_TRIGGER_SOURCES.forEach((source) => {
    const duration = savedStability[source];
    if (isFiniteNumber(duration) && duration >= 0 && duration <= 2_000) {
      gestureStabilityMs[source] = duration;
    }
  });
  return { inferenceFps: value.inferenceFps, gestureStabilityMs };
}

function cloneVisionTuning(preferences: VisionTuningPreferences): VisionTuningPreferences {
  return {
    inferenceFps: preferences.inferenceFps,
    gestureStabilityMs: { ...preferences.gestureStabilityMs },
  };
}

function isChannelScore(value: unknown): value is ChannelScore {
  if (!isRecord(value)) return false;
  return (
    isCalibrationTask(value.task) &&
    isInputChannelId(value.channel) &&
    isInputSourceId(value.source) &&
    isFiniteNumber(value.trialCount) &&
    isFiniteNumber(value.successCount) &&
    isFiniteNumber(value.successRate) &&
    (value.medianLatencyMs === null || isFiniteNumber(value.medianLatencyMs)) &&
    isFiniteNumber(value.falseActivationCount) &&
    isFiniteNumber(value.falseActivationObservationMs) &&
    isFiniteNumber(value.falseActivationsPerMinute) &&
    (value.directionMetrics === undefined || isDirectionMetrics(value.directionMetrics)) &&
    isFiniteNumber(value.recordedAt)
  );
}

function isDirectionMetrics(value: unknown): boolean {
  return isRecord(value) &&
    isFiniteNumber(value.meanAngularErrorDeg) &&
    isFiniteNumber(value.meanJitterDeg) &&
    isFiniteNumber(value.dropoutCount);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVisionInferenceFps(value: unknown): value is VisionInferenceFps {
  return typeof value === 'number' && VISION_INFERENCE_FPS_OPTIONS.some((fps) => fps === value);
}

function isCalibrationTask(value: unknown): value is CalibrationTask {
  return value === 'TRIGGER' || value === 'DIRECTION' || value === 'POINT';
}

function isInputChannelId(value: unknown): value is InputChannelId {
  return typeof value === 'string' && Object.values(InputChannelId).some((id) => id === value);
}

function isInputSourceId(value: unknown): value is InputSourceId {
  return typeof value === 'string' && Object.values(InputSourceId).some((id) => id === value);
}
