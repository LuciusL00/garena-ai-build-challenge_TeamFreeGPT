import type { InputSourceId } from '../sources.ts';

export interface GestureCommandCandidate {
  readonly source: InputSourceId;
  readonly confidence: number;
}

export interface GestureCommandGateConfig {
  readonly enterConfidence: number;
  readonly exitConfidence: number;
  readonly stabilityMs: number;
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

export type GestureCommandGateState = 'READY' | 'CANDIDATE' | 'LOCKED';

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
  private firedAt: number | null = null;
  private neutralSince: number | null = null;

  constructor(
    private readonly onActivation: (candidate: GestureCommandCandidate, timestamp: number) => void,
    private readonly config: GestureCommandGateConfig = DEFAULT_GESTURE_COMMAND_CONFIG,
  ) {
    if (config.exitConfidence >= config.enterConfidence) {
      throw new Error('exitConfidence must be lower than enterConfidence.');
    }
    if (config.stabilityMs < 0 || config.cooldownMs < 0 || config.neutralMs < 0) {
      throw new Error('Gesture timing windows cannot be negative.');
    }
  }

  get state(): GestureCommandGateState {
    return this.stateValue;
  }

  get activeSource(): InputSourceId | null {
    return this.candidate?.source ?? null;
  }

  update(timestamp: number, candidate: GestureCommandCandidate | null): void {
    const recognized = candidate && candidate.confidence >= this.config.enterConfidence
      ? candidate
      : null;

    if (this.stateValue === 'LOCKED') {
      if (candidate && candidate.confidence > this.config.exitConfidence) {
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
