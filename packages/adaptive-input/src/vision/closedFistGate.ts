export type ClosedFistGateState = 'OPEN' | 'CANDIDATE' | 'FIRED' | 'RELEASING';

export interface ClosedFistObservation {
  readonly timestamp: number;
  readonly confidence: number;
}

export interface ClosedFistGateConfig {
  readonly enterConfidence: number;
  readonly exitConfidence: number;
  readonly stabilityMs: number;
  readonly releaseMs: number;
}

export const DEFAULT_CLOSED_FIST_CONFIG: ClosedFistGateConfig = {
  enterConfidence: 0.75,
  exitConfidence: 0.45,
  stabilityMs: 200,
  releaseMs: 120,
};

export class ClosedFistGate {
  private stateValue: ClosedFistGateState = 'OPEN';
  private candidateSince: number | null = null;
  private releaseSince: number | null = null;

  constructor(
    private readonly onActivation: (observation: ClosedFistObservation) => void,
    private readonly config: ClosedFistGateConfig = DEFAULT_CLOSED_FIST_CONFIG,
  ) {
    if (config.exitConfidence >= config.enterConfidence) {
      throw new Error('exitConfidence must be lower than enterConfidence.');
    }
  }

  get state(): ClosedFistGateState {
    return this.stateValue;
  }

  update(observation: ClosedFistObservation): void {
    if (this.stateValue === 'OPEN') {
      if (observation.confidence >= this.config.enterConfidence) {
        this.stateValue = 'CANDIDATE';
        this.candidateSince = observation.timestamp;
      }
      return;
    }
    if (this.stateValue === 'CANDIDATE') {
      if (observation.confidence < this.config.enterConfidence) {
        this.reset();
      } else if (
        this.candidateSince !== null &&
        observation.timestamp - this.candidateSince >= this.config.stabilityMs
      ) {
        this.stateValue = 'FIRED';
        this.candidateSince = null;
        this.onActivation(observation);
      }
      return;
    }
    if (this.stateValue === 'FIRED') {
      if (observation.confidence <= this.config.exitConfidence) {
        this.stateValue = 'RELEASING';
        this.releaseSince = observation.timestamp;
      }
      return;
    }
    if (observation.confidence > this.config.exitConfidence) {
      this.stateValue = 'FIRED';
      this.releaseSince = null;
    } else if (
      this.releaseSince !== null &&
      observation.timestamp - this.releaseSince >= this.config.releaseMs
    ) {
      this.reset();
    }
  }

  reset(): void {
    this.stateValue = 'OPEN';
    this.candidateSince = null;
    this.releaseSince = null;
  }
}
