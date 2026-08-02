import type { ActivationEvent, CalibrationSource, Clock } from '../input/types.ts';
import { monotonicClock } from '../input/types.ts';

export type CalibrationTrialOutcome = 'SUCCESS' | 'TIMEOUT';

export interface CalibrationTrialSample {
  readonly trial: number;
  readonly source: string;
  readonly outcome: CalibrationTrialOutcome;
  readonly cueTimestamp: number;
  readonly activationTimestamp?: number;
  readonly latencyMs?: number;
  readonly confidence?: number;
  readonly falseActivationsBeforeCue: number;
}

export interface CalibrationHarnessConfig {
  readonly trialCount: number;
  readonly cueDelayMinMs: number;
  readonly cueDelayMaxMs: number;
  readonly responseTimeoutMs: number;
}

export interface CalibrationHarnessCallbacks {
  onWaiting?(trial: number): void;
  onCue?(trial: number, cueTimestamp: number): void;
  onSample?(sample: CalibrationTrialSample): void;
}

export const DEFAULT_CALIBRATION_CONFIG: CalibrationHarnessConfig = {
  trialCount: 12,
  cueDelayMinMs: 1_500,
  cueDelayMaxMs: 3_500,
  responseTimeoutMs: 2_500,
};

export class CalibrationHarness {
  private aborted = false;
  private activeCleanup: (() => void) | null = null;

  public constructor(
    private readonly clock: Clock = monotonicClock,
    private readonly random: () => number = Math.random,
  ) {}

  public async run(
    source: CalibrationSource,
    callbacks: CalibrationHarnessCallbacks = {},
    config: CalibrationHarnessConfig = DEFAULT_CALIBRATION_CONFIG,
  ): Promise<readonly CalibrationTrialSample[]> {
    this.validate(config);
    this.abort();
    this.aborted = false;

    const samples: CalibrationTrialSample[] = [];
    for (let trial = 1; trial <= config.trialCount && !this.aborted; trial += 1) {
      callbacks.onWaiting?.(trial);
      const sample = await this.runTrial(source, trial, callbacks, config);
      if (!sample) break;
      samples.push(sample);
      callbacks.onSample?.(sample);
    }

    this.activeCleanup?.();
    this.activeCleanup = null;
    return samples;
  }

  public abort(): void {
    this.aborted = true;
    this.activeCleanup?.();
    this.activeCleanup = null;
  }

  private runTrial(
    source: CalibrationSource,
    trial: number,
    callbacks: CalibrationHarnessCallbacks,
    config: CalibrationHarnessConfig,
  ): Promise<CalibrationTrialSample | null> {
    return new Promise((resolve) => {
      let cueTimestamp: number | null = null;
      let falseActivationsBeforeCue = 0;
      let cueTimer: ReturnType<typeof setTimeout> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      let unsubscribe = () => {};

      const settle = (sample: CalibrationTrialSample | null) => {
        if (settled) return;
        settled = true;
        if (cueTimer !== null) clearTimeout(cueTimer);
        if (timeoutTimer !== null) clearTimeout(timeoutTimer);
        unsubscribe();
        this.activeCleanup = null;
        resolve(sample);
      };

      const onActivation = (event: ActivationEvent) => {
        if (cueTimestamp === null) {
          falseActivationsBeforeCue += 1;
          return;
        }

        settle({
          trial,
          source: source.id,
          outcome: 'SUCCESS',
          cueTimestamp,
          activationTimestamp: event.timestamp,
          latencyMs: Math.max(0, event.timestamp - cueTimestamp),
          confidence: event.confidence,
          falseActivationsBeforeCue,
        });
      };

      const registeredUnsubscribe = source.subscribe(onActivation);
      if (settled) registeredUnsubscribe();
      else unsubscribe = registeredUnsubscribe;
      this.activeCleanup = () => settle(null);

      const cueDelay =
        config.cueDelayMinMs +
        this.random() * (config.cueDelayMaxMs - config.cueDelayMinMs);

      cueTimer = setTimeout(() => {
        if (this.aborted) {
          settle(null);
          return;
        }

        cueTimestamp = this.clock.now();
        callbacks.onCue?.(trial, cueTimestamp);
        timeoutTimer = setTimeout(() => {
          if (cueTimestamp === null) return;
          settle({
            trial,
            source: source.id,
            outcome: 'TIMEOUT',
            cueTimestamp,
            falseActivationsBeforeCue,
          });
        }, config.responseTimeoutMs);
      }, cueDelay);
    });
  }

  private validate(config: CalibrationHarnessConfig): void {
    if (!Number.isInteger(config.trialCount) || config.trialCount <= 0) {
      throw new Error('trialCount must be a positive integer.');
    }
    if (config.cueDelayMinMs < 0 || config.cueDelayMaxMs < config.cueDelayMinMs) {
      throw new Error('Cue-delay range is invalid.');
    }
    if (config.responseTimeoutMs <= 0) {
      throw new Error('responseTimeoutMs must be positive.');
    }
  }
}
