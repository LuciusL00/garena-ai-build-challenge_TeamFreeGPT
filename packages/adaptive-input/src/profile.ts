/** Persistent player calibration scores, keyed by neutral task and source. */

import type { CalibrationTask } from './actions.ts';
import type { ChannelScore } from './recommendation/types.ts';
import { InputChannelId, InputSourceId } from './sources.ts';

const PROFILE_VERSION = 2;
const DEFAULT_STORAGE_KEY = 'teamfreegpt.adaptive-input.profile.v2';

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

function scoreKey(task: CalibrationTask, source: InputSourceId): string {
  return `${task}:${source}`;
}

function readScores(value: unknown): readonly ChannelScore[] {
  if (!isRecord(value) || value.version !== PROFILE_VERSION || !Array.isArray(value.scores)) {
    return [];
  }
  return value.scores.filter(isChannelScore);
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
    isFiniteNumber(value.recordedAt)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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
