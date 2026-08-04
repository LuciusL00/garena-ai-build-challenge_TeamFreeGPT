import type { ActionId } from '../actions.ts';
import {
  channelOf,
  type DirectionEndInputSignal,
  type DirectionInputSignal,
  type InputSignal,
  type InputSourceId,
} from '../sources.ts';
import type { CalibrationClock } from './harness.ts';
import { monotonicCalibrationClock } from './harness.ts';

export type DirectionCue = 'up' | 'down' | 'left' | 'right';
export interface DirectionTrial<A extends ActionId = ActionId> {
  readonly trialIndex: number;
  readonly action: A;
  readonly target: DirectionCue;
  readonly targetVector: { x: number; y: number };
  readonly cueAt: number;
  readonly respondedAt: number | null;
  readonly latencyMs: number | null;
  readonly outcome: 'success' | 'miss';
  readonly angularErrorDeg: number | null;
  readonly jitterDeg: number;
  readonly dropoutCount: number;
}
export interface DirectionCalibrationSession<A extends ActionId = ActionId> {
  readonly id: string;
  readonly task: 'DIRECTION';
  readonly channelUnderTest: ReturnType<typeof channelOf>;
  readonly sourceUnderTest: InputSourceId;
  readonly action: A;
  readonly startedAt: number;
  readonly trials: readonly DirectionTrial<A>[];
}
export interface DirectionCalibrationSource {
  readonly source: InputSourceId;
  subscribe(listener: (signal: DirectionInputSignal | DirectionEndInputSignal) => void): () => void;
}

export class DirectionSignalSource implements DirectionCalibrationSource {
  private readonly listeners = new Set<(signal: DirectionInputSignal | DirectionEndInputSignal) => void>();
  constructor(readonly source: InputSourceId) {}
  accept(signal: InputSignal): void {
    if (signal.source !== this.source || (signal.kind !== 'direction' && signal.kind !== 'direction-end')) return;
    this.listeners.forEach((listener) => listener(signal));
  }
  subscribe(listener: (signal: DirectionInputSignal | DirectionEndInputSignal) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export interface DirectionHarnessConfig {
  readonly trialCount: number;
  readonly responseTimeoutMs: number;
  readonly stabilityMs: number;
  readonly toleranceDeg: number;
}
export const DEFAULT_DIRECTION_HARNESS_CONFIG: DirectionHarnessConfig = {
  trialCount: 8,
  responseTimeoutMs: 3_000,
  stabilityMs: 250,
  toleranceDeg: 30,
};
export interface DirectionHarnessCallbacks<A extends ActionId> {
  onCue?(trialIndex: number, cue: DirectionCue): void;
  onTrial?(trial: DirectionTrial<A>): void;
}

const TARGETS: Record<DirectionCue, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const CUES = Object.keys(TARGETS) as DirectionCue[];

export class DirectionCalibrationHarness {
  private aborted = false;
  private cleanup: (() => void) | null = null;
  constructor(
    private readonly clock: CalibrationClock = monotonicCalibrationClock,
    private readonly random: () => number = Math.random,
  ) {}

  async run<A extends ActionId>(
    request: { sessionId: string; action: A; source: DirectionCalibrationSource },
    callbacks: DirectionHarnessCallbacks<A> = {},
    overrides: Partial<DirectionHarnessConfig> = {},
  ): Promise<DirectionCalibrationSession<A>> {
    this.abort();
    this.aborted = false;
    const config = { ...DEFAULT_DIRECTION_HARNESS_CONFIG, ...overrides };
    validate(config);
    const trials: DirectionTrial<A>[] = [];
    const startedAt = this.clock.now();
    for (let index = 0; index < config.trialCount && !this.aborted; index += 1) {
      const cue = CUES[Math.floor(this.random() * CUES.length) % CUES.length];
      callbacks.onCue?.(index, cue);
      const trial = await this.runTrial(request.action, request.source, index, cue, config);
      if (!trial) break;
      trials.push(trial);
      callbacks.onTrial?.(trial);
    }
    return {
      id: request.sessionId,
      task: 'DIRECTION',
      channelUnderTest: channelOf(request.source.source),
      sourceUnderTest: request.source.source,
      action: request.action,
      startedAt,
      trials,
    };
  }

  abort(): void {
    this.aborted = true;
    this.cleanup?.();
    this.cleanup = null;
  }

  private runTrial<A extends ActionId>(
    action: A,
    source: DirectionCalibrationSource,
    trialIndex: number,
    target: DirectionCue,
    config: DirectionHarnessConfig,
  ): Promise<DirectionTrial<A> | null> {
    return new Promise((resolve) => {
      const cueAt = this.clock.now();
      let stableSince: number | null = null;
      let lastDirection: { x: number; y: number } | null = null;
      let errorAtSuccess: number | null = null;
      let jitterTotal = 0;
      let jitterSamples = 0;
      let dropoutCount = 0;
      let seenDirection = false;
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let unsubscribe: () => void = () => undefined;
      const settle = (trial: DirectionTrial<A> | null): void => {
        if (settled) return;
        settled = true;
        if (timeout !== null) clearTimeout(timeout);
        unsubscribe();
        this.cleanup = null;
        resolve(trial);
      };
      const finish = (timestamp: number): void => settle({
        trialIndex,
        action,
        target,
        targetVector: TARGETS[target],
        cueAt,
        respondedAt: timestamp,
        latencyMs: Math.max(0, timestamp - cueAt),
        outcome: 'success',
        angularErrorDeg: errorAtSuccess,
        jitterDeg: jitterSamples === 0 ? 0 : jitterTotal / jitterSamples,
        dropoutCount,
      });
      unsubscribe = source.subscribe((signal) => {
        if (signal.kind === 'direction-end') {
          if (seenDirection) dropoutCount += 1;
          stableSince = null;
          lastDirection = null;
          return;
        }
        seenDirection = true;
        if (lastDirection) {
          jitterTotal += angularError(lastDirection, signal.direction);
          jitterSamples += 1;
        }
        lastDirection = signal.direction;
        const error = angularError(TARGETS[target], signal.direction);
        if (error > config.toleranceDeg) {
          stableSince = null;
          return;
        }
        if (stableSince === null) stableSince = signal.timestamp;
        errorAtSuccess = error;
        if (signal.timestamp - stableSince >= config.stabilityMs) finish(signal.timestamp);
      });
      timeout = setTimeout(() => settle({
        trialIndex,
        action,
        target,
        targetVector: TARGETS[target],
        cueAt,
        respondedAt: null,
        latencyMs: null,
        outcome: 'miss',
        angularErrorDeg: null,
        jitterDeg: jitterSamples === 0 ? 0 : jitterTotal / jitterSamples,
        dropoutCount,
      }), config.responseTimeoutMs);
      this.cleanup = () => settle(null);
    });
  }
}

export function angularError(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const denominator = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  if (denominator < Number.EPSILON) return 180;
  const cosine = (a.x * b.x + a.y * b.y) / denominator;
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

function validate(config: DirectionHarnessConfig): void {
  if (!Number.isInteger(config.trialCount) || config.trialCount <= 0) throw new Error('trialCount must be positive.');
  if (config.responseTimeoutMs <= 0 || config.stabilityMs < 0) throw new Error('Direction timing must be non-negative.');
  if (config.toleranceDeg <= 0 || config.toleranceDeg >= 180) throw new Error('toleranceDeg must be between 0 and 180.');
}
