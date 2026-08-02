/** Channel-neutral cue/response calibration, adapted from Vivin's prototype. */

import type { ActionId } from '../actions.ts';
import {
  channelOf,
  type InputSignal,
  type InputSourceId,
  type TriggerInputSignal,
} from '../sources.ts';
import {
  ANTICIPATION_FLOOR_MS,
  CUE_DELAY_RANGE_MS,
  NO_CUE_WINDOW_MS,
  RESPONSE_TIMEOUT_MS,
  TRIALS_INITIAL,
  type CalibrationSession,
  type CalibrationTrial,
  type FalseActivation,
} from './types.ts';

export interface CalibrationSource {
  readonly source: InputSourceId;
  subscribe(listener: (signal: TriggerInputSignal) => void): () => void;
}

/**
 * Small bridge from neutral channel signals to the calibration harness.
 * Feed every channel signal into accept(); only matching trigger signals pass.
 */
export class TriggerCalibrationSource implements CalibrationSource {
  private readonly listeners = new Set<(signal: TriggerInputSignal) => void>();

  constructor(readonly source: InputSourceId) {}

  accept(signal: InputSignal): void {
    if (signal.kind !== 'trigger' || signal.source !== this.source) return;
    this.listeners.forEach((listener) => listener(signal));
  }

  subscribe(listener: (signal: TriggerInputSignal) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export interface CalibrationClock {
  now(): number;
}

export const monotonicCalibrationClock: CalibrationClock = {
  now: () => performance.now(),
};

export interface CalibrationHarnessConfig {
  readonly trialCount: number;
  readonly cueDelayRangeMs: readonly [number, number];
  readonly responseTimeoutMs: number;
  readonly noCueWindowMs: number;
}

export const DEFAULT_CALIBRATION_HARNESS_CONFIG: CalibrationHarnessConfig = {
  trialCount: TRIALS_INITIAL,
  cueDelayRangeMs: CUE_DELAY_RANGE_MS,
  responseTimeoutMs: RESPONSE_TIMEOUT_MS,
  noCueWindowMs: NO_CUE_WINDOW_MS,
};

export interface CalibrationRunRequest<A extends ActionId> {
  readonly sessionId: string;
  readonly action: A;
  readonly source: CalibrationSource;
}

export interface CalibrationHarnessCallbacks<A extends ActionId> {
  onWaiting?(trialIndex: number): void;
  onCue?(trialIndex: number, cueAt: number): void;
  onTrial?(trial: CalibrationTrial<A>): void;
  onNoCueWindow?(startedAt: number): void;
}

/**
 * Measures touch and vision with the same cue timing and result shape.
 * Call abort() when leaving the calibration screen.
 */
export class CalibrationHarness {
  private aborted = false;
  private activeCleanup: (() => void) | null = null;

  constructor(
    private readonly clock: CalibrationClock = monotonicCalibrationClock,
    private readonly random: () => number = Math.random,
  ) {}

  async run<A extends ActionId>(
    request: CalibrationRunRequest<A>,
    callbacks: CalibrationHarnessCallbacks<A> = {},
    overrides: Partial<CalibrationHarnessConfig> = {},
  ): Promise<CalibrationSession<A>> {
    const config = this.resolveConfig(overrides);
    this.abort();
    this.aborted = false;

    const session: CalibrationSession<A> = {
      id: request.sessionId,
      channelUnderTest: channelOf(request.source.source),
      action: request.action,
      startedAt: this.clock.now(),
      trials: [],
      falseActivations: [],
      noCueWindowMs: config.noCueWindowMs,
    };

    for (
      let trialIndex = 0;
      trialIndex < config.trialCount && !this.aborted;
      trialIndex += 1
    ) {
      callbacks.onWaiting?.(trialIndex);
      const trial = await this.runTrial(
        request.action,
        request.source,
        trialIndex,
        session.falseActivations,
        callbacks,
        config,
      );
      if (!trial) break;
      session.trials.push(trial);
      callbacks.onTrial?.(trial);
    }

    if (!this.aborted && config.noCueWindowMs > 0) {
      await this.runNoCueWindow(
        request.action,
        request.source,
        session.falseActivations,
        callbacks,
        config.noCueWindowMs,
      );
    }

    this.activeCleanup?.();
    this.activeCleanup = null;
    return session;
  }

  abort(): void {
    this.aborted = true;
    this.activeCleanup?.();
    this.activeCleanup = null;
  }

  private runTrial<A extends ActionId>(
    action: A,
    source: CalibrationSource,
    trialIndex: number,
    falseActivations: FalseActivation<A>[],
    callbacks: CalibrationHarnessCallbacks<A>,
    config: CalibrationHarnessConfig,
  ): Promise<CalibrationTrial<A> | null> {
    return new Promise((resolve) => {
      let cueAt: number | null = null;
      let cueTimer: ReturnType<typeof setTimeout> | null = null;
      let responseTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      let unsubscribe: () => void = () => undefined;

      const settle = (trial: CalibrationTrial<A> | null): void => {
        if (settled) return;
        settled = true;
        if (cueTimer !== null) clearTimeout(cueTimer);
        if (responseTimer !== null) clearTimeout(responseTimer);
        unsubscribe();
        this.activeCleanup = null;
        resolve(trial);
      };

      const onSignal = (signal: TriggerInputSignal): void => {
        if (signal.source !== source.source) return;
        if (cueAt === null) {
          falseActivations.push({
            action,
            source: signal.source,
            timestamp: signal.timestamp,
            confidence: signal.confidence,
            context: 'pre-cue',
          });
          return;
        }

        const latencyMs = Math.max(0, signal.timestamp - cueAt);
        settle({
          trialIndex,
          action,
          cueAt,
          respondedAt: signal.timestamp,
          latencyMs,
          source: signal.source,
          confidence: signal.confidence,
          outcome: latencyMs < ANTICIPATION_FLOOR_MS ? 'anticipated' : 'success',
          extraActivations: 0,
        });
      };

      const registeredUnsubscribe = source.subscribe(onSignal);
      if (settled) registeredUnsubscribe();
      else unsubscribe = registeredUnsubscribe;
      this.activeCleanup = () => settle(null);

      const [minimumDelay, maximumDelay] = config.cueDelayRangeMs;
      const randomUnit = Math.max(0, Math.min(1, this.random()));
      const cueDelay = minimumDelay + randomUnit * (maximumDelay - minimumDelay);

      cueTimer = setTimeout(() => {
        if (this.aborted) {
          settle(null);
          return;
        }

        cueAt = this.clock.now();
        responseTimer = setTimeout(() => {
          if (cueAt === null) return;
          settle({
            trialIndex,
            action,
            cueAt,
            respondedAt: null,
            latencyMs: null,
            source: null,
            outcome: 'miss',
            extraActivations: 0,
          });
        }, config.responseTimeoutMs);
        callbacks.onCue?.(trialIndex, cueAt);
      }, cueDelay);
    });
  }

  private runNoCueWindow<A extends ActionId>(
    action: A,
    source: CalibrationSource,
    falseActivations: FalseActivation<A>[],
    callbacks: CalibrationHarnessCallbacks<A>,
    durationMs: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let unsubscribe: () => void = () => undefined;

      const settle = (): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        unsubscribe();
        this.activeCleanup = null;
        resolve();
      };

      const registeredUnsubscribe = source.subscribe((signal) => {
        if (signal.source !== source.source) return;
        falseActivations.push({
          action,
          source: signal.source,
          timestamp: signal.timestamp,
          confidence: signal.confidence,
          context: 'no-cue-window',
        });
      });
      if (settled) registeredUnsubscribe();
      else unsubscribe = registeredUnsubscribe;

      timer = setTimeout(settle, durationMs);
      this.activeCleanup = settle;
      callbacks.onNoCueWindow?.(this.clock.now());
    });
  }

  private resolveConfig(
    overrides: Partial<CalibrationHarnessConfig>,
  ): CalibrationHarnessConfig {
    const config: CalibrationHarnessConfig = {
      ...DEFAULT_CALIBRATION_HARNESS_CONFIG,
      ...overrides,
    };
    const [minimumDelay, maximumDelay] = config.cueDelayRangeMs;

    if (!Number.isInteger(config.trialCount) || config.trialCount <= 0) {
      throw new Error('trialCount must be a positive integer.');
    }
    if (minimumDelay < 0 || maximumDelay < minimumDelay) {
      throw new Error('cueDelayRangeMs must be a valid non-negative range.');
    }
    if (config.responseTimeoutMs <= 0) {
      throw new Error('responseTimeoutMs must be positive.');
    }
    if (config.noCueWindowMs < 0) {
      throw new Error('noCueWindowMs cannot be negative.');
    }
    return config;
  }
}
