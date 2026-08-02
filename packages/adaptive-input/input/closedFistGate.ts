export type ClosedFistGateState = 'OPEN' | 'CANDIDATE' | 'FIRED' | 'RELEASING';

export interface ClosedFistObservation {
  readonly timestamp: number;
  readonly confidence: number;
}

export interface ClosedFistActivation extends ClosedFistObservation {}

export interface ClosedFistGateConfig {
  /** Confidence required to begin and maintain a fist candidate. */
  readonly enterConfidence: number;
  /** Confidence below which a fired gesture begins re-arming. */
  readonly exitConfidence: number;
  /** Continuous confident-fist time required before firing. */
  readonly stabilityMs: number;
  /** Continuous released time required before another activation is allowed. */
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

  public constructor(
    private readonly onActivation: (activation: ClosedFistActivation) => void,
    private readonly config: ClosedFistGateConfig = DEFAULT_CLOSED_FIST_CONFIG,
  ) {
    if (config.exitConfidence >= config.enterConfidence) {
      throw new Error('exitConfidence must be lower than enterConfidence.');
    }
    if (config.stabilityMs < 0 || config.releaseMs < 0) {
      throw new Error('Gesture timing windows cannot be negative.');
    }
  }

  public get state(): ClosedFistGateState {
    return this.stateValue;
  }

  public update(observation: ClosedFistObservation): void {
    switch (this.stateValue) {
      case 'OPEN':
        if (observation.confidence >= this.config.enterConfidence) {
          this.stateValue = 'CANDIDATE';
          this.candidateSince = observation.timestamp;
          this.fireIfStable(observation);
        }
        return;

      case 'CANDIDATE':
        if (observation.confidence < this.config.enterConfidence) {
          this.reset();
          return;
        }
        this.fireIfStable(observation);
        return;

      case 'FIRED':
        if (observation.confidence <= this.config.exitConfidence) {
          this.stateValue = 'RELEASING';
          this.releaseSince = observation.timestamp;
          this.rearmIfReleased(observation.timestamp);
        }
        return;

      case 'RELEASING':
        if (observation.confidence > this.config.exitConfidence) {
          this.stateValue = 'FIRED';
          this.releaseSince = null;
          return;
        }
        this.rearmIfReleased(observation.timestamp);
    }
  }

  public reset(): void {
    this.stateValue = 'OPEN';
    this.candidateSince = null;
    this.releaseSince = null;
  }

  private fireIfStable(observation: ClosedFistObservation): void {
    if (this.candidateSince === null) return;
    if (observation.timestamp - this.candidateSince < this.config.stabilityMs) return;

    this.stateValue = 'FIRED';
    this.candidateSince = null;
    this.onActivation(observation);
  }

  private rearmIfReleased(timestamp: number): void {
    if (this.releaseSince === null) return;
    if (timestamp - this.releaseSince < this.config.releaseMs) return;
    this.reset();
  }
}
