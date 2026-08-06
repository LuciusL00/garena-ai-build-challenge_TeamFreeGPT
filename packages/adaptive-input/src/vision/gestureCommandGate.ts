import type { InputSourceId } from '../sources.ts';

export interface GestureCommandCandidate {
  readonly source: InputSourceId;
  readonly confidence: number;
}

export interface GestureCommandGateConfig {
  readonly enterConfidence: number;
  readonly exitConfidence: number;
  readonly stabilityMs: number;
  readonly stabilityMsBySource?: Readonly<Partial<Record<InputSourceId, number>>>;
  readonly cooldownMs: number;
  readonly neutralMs: number;
}

export const DEFAULT_GESTURE_COMMAND_CONFIG: GestureCommandGateConfig = {
  enterConfidence: 0.55,
  exitConfidence: 0.35,
  stabilityMs: 200,
  cooldownMs: 450,
  neutralMs: 150,
};

export type GestureCommandGateState = 'READY' | 'CANDIDATE' | 'LOCKED' | 'TRANSITION';

export const RAPID_GESTURE_STABILITY_STEPS_MS = [320, 280, 240, 200, 160, 120] as const;

export interface RapidGestureStepResult {
  readonly stabilityMs: number;
  readonly cueDetected: boolean;
  readonly neutralRecovered: boolean;
  /** The candidate would also have fired while the hand was being relaxed. */
  readonly accidentalActivation: boolean;
}

export const RAPID_GESTURE_CONFIRMATIONS = 5;

export type RapidGesturePhase = 'DESCEND' | 'CONFIRM' | 'DONE';

/**
 * Drives the hold-time staircase and its confirmation runs.
 *
 * One pass down the steps is not evidence: the shortest hold nearly always
 * detects a cue the player is deliberately making, so a single descent tends to
 * reach the fastest step whatever the device does. Repeating the reached step
 * several times is what separates a hold time that works from one that only
 * worked once; a failure there steps back to the next slower hold and repeats.
 */
export class RapidGestureTuner {
  private descendIndex = 0;
  private candidateIndex: number | null = null;
  private passedConfirmations = 0;
  private phaseValue: RapidGesturePhase = 'DESCEND';
  private result: number | null = null;

  constructor(private readonly confirmations: number = RAPID_GESTURE_CONFIRMATIONS) {
    if (!Number.isInteger(confirmations) || confirmations < 1) {
      throw new RangeError('A tuner needs at least one confirmation run.');
    }
  }

  get phase(): RapidGesturePhase {
    return this.phaseValue;
  }

  /** The hold time the next cue should test, or null once the run is finished. */
  get pendingStabilityMs(): number | null {
    if (this.phaseValue === 'DONE') return null;
    const index = this.phaseValue === 'DESCEND' ? this.descendIndex : this.candidateIndex;
    return index === null ? null : RAPID_GESTURE_STABILITY_STEPS_MS[index] ?? null;
  }

  get confirmationsPassed(): number {
    return this.passedConfirmations;
  }

  get confirmationsRequired(): number {
    return this.confirmations;
  }

  get recommendation(): number | null {
    return this.result;
  }

  record(passed: boolean): void {
    if (this.phaseValue === 'DONE') return;
    if (this.phaseValue === 'DESCEND') {
      if (!passed) {
        this.startConfirming();
        return;
      }
      this.candidateIndex = this.descendIndex;
      this.descendIndex += 1;
      if (this.descendIndex >= RAPID_GESTURE_STABILITY_STEPS_MS.length) this.startConfirming();
      return;
    }
    if (passed) {
      this.passedConfirmations += 1;
      if (this.passedConfirmations >= this.confirmations) {
        this.result = this.candidateIndex === null
          ? null
          : RAPID_GESTURE_STABILITY_STEPS_MS[this.candidateIndex] ?? null;
        this.phaseValue = 'DONE';
      }
      return;
    }
    // A confirmation failed: fall back to the next slower hold and start over.
    this.passedConfirmations = 0;
    this.candidateIndex = this.candidateIndex === null ? null : this.candidateIndex - 1;
    if (this.candidateIndex === null || this.candidateIndex < 0) {
      this.candidateIndex = null;
      this.phaseValue = 'DONE';
    }
  }

  private startConfirming(): void {
    if (this.candidateIndex === null) {
      this.phaseValue = 'DONE';
      return;
    }
    this.phaseValue = 'CONFIRM';
    this.passedConfirmations = 0;
  }
}

/** Selects one command pose for one processed hand. Ties keep detector order. */
export function highestConfidenceGestureCommand(
  candidates: readonly GestureCommandCandidate[],
): GestureCommandCandidate | null {
  return candidates.reduce<GestureCommandCandidate | null>(
    (highest, candidate) => !highest || candidate.confidence > highest.confidence
      ? candidate
      : highest,
    null,
  );
}

/**
 * Gates the selected, game-blind command pose for one processed hand.
 *
 * A future multi-hand implementation can create one instance per tracked hand;
 * this class does not impose a global command lock across hands.
 */
export class GestureCommandGate {
  private stateValue: GestureCommandGateState = 'READY';
  private candidate: GestureCommandCandidate | null = null;
  private candidateSince: number | null = null;
  private lockedSource: InputSourceId | null = null;
  private firedAt: number | null = null;
  private neutralSince: number | null = null;

  constructor(
    private readonly onActivation: (candidate: GestureCommandCandidate, timestamp: number) => void,
    private config: GestureCommandGateConfig = DEFAULT_GESTURE_COMMAND_CONFIG,
  ) {
    if (config.exitConfidence >= config.enterConfidence) {
      throw new Error('exitConfidence must be lower than enterConfidence.');
    }
    if (config.stabilityMs < 0 || config.cooldownMs < 0 || config.neutralMs < 0) {
      throw new Error('Gesture timing windows cannot be negative.');
    }
    this.config = { ...config, stabilityMsBySource: { ...config.stabilityMsBySource } };
  }

  get state(): GestureCommandGateState {
    return this.stateValue;
  }

  get activeSource(): InputSourceId | null {
    return this.stateValue === 'LOCKED'
      ? this.lockedSource
      : this.candidate?.source ?? null;
  }

  stabilityMsFor(source: InputSourceId): number {
    return this.config.stabilityMsBySource?.[source] ?? this.config.stabilityMs;
  }

  setStabilityMs(source: InputSourceId, stabilityMs: number): void {
    if (!Number.isFinite(stabilityMs) || stabilityMs < 0) {
      throw new Error('Gesture stability must be a non-negative finite duration.');
    }
    this.config = {
      ...this.config,
      stabilityMsBySource: { ...this.config.stabilityMsBySource, [source]: stabilityMs },
    };
    this.reset();
  }

  update(timestamp: number, candidate: GestureCommandCandidate | null): void {
    const recognized = candidate && candidate.confidence >= this.config.enterConfidence
      ? candidate
      : null;

    if (this.stateValue === 'LOCKED' || this.stateValue === 'TRANSITION') {
      const clearsExitThreshold = candidate && candidate.confidence > this.config.exitConfidence;
      if (clearsExitThreshold && candidate.source === this.lockedSource) {
        this.stateValue = 'LOCKED';
        this.candidate = null;
        this.candidateSince = null;
        this.neutralSince = null;
        return;
      }

      if (recognized && recognized.source !== this.lockedSource) {
        this.neutralSince = null;
        if (!this.candidate || this.candidate.source !== recognized.source) {
          this.stateValue = 'TRANSITION';
          this.candidate = recognized;
          this.candidateSince = timestamp;
          return;
        }
        this.stateValue = 'TRANSITION';
        this.candidate = recognized;
        const cooldownComplete = this.firedAt === null ||
          timestamp - this.firedAt >= this.config.cooldownMs;
        const transitionStable = this.candidateSince !== null &&
          timestamp - this.candidateSince >= this.stabilityMsFor(recognized.source);
        if (cooldownComplete && transitionStable) this.fire(recognized, timestamp);
        return;
      }

      this.stateValue = 'LOCKED';
      this.candidate = null;
      this.candidateSince = null;
      if (clearsExitThreshold) {
        this.neutralSince = null;
        return;
      }
      if (this.firedAt !== null && timestamp - this.firedAt < this.config.cooldownMs) return;
      this.neutralSince ??= timestamp;
      if (timestamp - this.neutralSince >= this.config.neutralMs) this.reset();
      return;
    }

    if (!recognized) {
      this.stateValue = 'READY';
      this.candidate = null;
      this.candidateSince = null;
      return;
    }

    if (!this.candidate || this.candidate.source !== recognized.source) {
      this.stateValue = 'CANDIDATE';
      this.candidate = recognized;
      this.candidateSince = timestamp;
      return;
    }

    this.candidate = recognized;
    if (
      this.candidateSince !== null &&
      timestamp - this.candidateSince >= this.stabilityMsFor(recognized.source)
    ) {
      this.fire(recognized, timestamp);
    }
  }

  private fire(candidate: GestureCommandCandidate, timestamp: number): void {
    this.stateValue = 'LOCKED';
    this.candidate = null;
    this.candidateSince = null;
    this.lockedSource = candidate.source;
    this.firedAt = timestamp;
    this.neutralSince = null;
    this.onActivation(candidate, timestamp);
  }

  reset(): void {
    this.stateValue = 'READY';
    this.candidate = null;
    this.candidateSince = null;
    this.lockedSource = null;
    this.firedAt = null;
    this.neutralSince = null;
  }
}
