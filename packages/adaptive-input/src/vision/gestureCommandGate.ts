import type { InputSourceId } from '../sources.ts';

export interface GestureCommandCandidate {
  readonly source: InputSourceId;
  readonly confidence: number;
}

export interface GestureCommandGateConfig {
  readonly enterConfidence: number;
  readonly stabilityMs: number;
  readonly cooldownMs: number;
  readonly neutralMs: number;
}

export const DEFAULT_GESTURE_COMMAND_CONFIG: GestureCommandGateConfig = {
  enterConfidence: 0.75,
  stabilityMs: 200,
  cooldownMs: 450,
  neutralMs: 150,
};

export type GestureCommandGateState = 'READY' | 'CANDIDATE' | 'LOCKED';

/** Arbitrates mutually-exclusive one-shot hand commands and requires neutral re-arming. */
export class GestureCommandGate {
  private stateValue: GestureCommandGateState = 'READY';
  private candidate: GestureCommandCandidate | null = null;
  private candidateSince: number | null = null;
  private firedAt: number | null = null;
  private neutralSince: number | null = null;

  constructor(
    private readonly onActivation: (candidate: GestureCommandCandidate, timestamp: number) => void,
    private readonly config: GestureCommandGateConfig = DEFAULT_GESTURE_COMMAND_CONFIG,
  ) {}

  get state(): GestureCommandGateState {
    return this.stateValue;
  }

  update(timestamp: number, candidate: GestureCommandCandidate | null): void {
    const recognized = candidate && candidate.confidence >= this.config.enterConfidence
      ? candidate
      : null;

    if (this.stateValue === 'LOCKED') {
      if (recognized) {
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
      timestamp - this.candidateSince >= this.config.stabilityMs
    ) {
      this.stateValue = 'LOCKED';
      this.firedAt = timestamp;
      this.neutralSince = null;
      this.onActivation(recognized, timestamp);
    }
  }

  reset(): void {
    this.stateValue = 'READY';
    this.candidate = null;
    this.candidateSince = null;
    this.firedAt = null;
    this.neutralSince = null;
  }
}
