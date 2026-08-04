/** Vivin's closed-fist fire-once gate, used by the integration test page. */

export type ClosedFistGateState = 'OPEN' | 'CANDIDATE' | 'FIRED' | 'RELEASING';

export interface ClosedFistObservation {
  readonly timestamp: number;
  readonly confidence: number;
}

const ENTER_CONFIDENCE = 0.75;
const EXIT_CONFIDENCE = 0.45;
const STABILITY_MS = 200;
const RELEASE_MS = 120;

export class ClosedFistGate {
  private stateValue: ClosedFistGateState = 'OPEN';
  private candidateSince: number | null = null;
  private releaseSince: number | null = null;

  constructor(private readonly onActivation: (observation: ClosedFistObservation) => void) {}

  get state(): ClosedFistGateState {
    return this.stateValue;
  }

  update(observation: ClosedFistObservation): void {
    if (this.stateValue === 'OPEN') {
      if (observation.confidence >= ENTER_CONFIDENCE) {
        this.stateValue = 'CANDIDATE';
        this.candidateSince = observation.timestamp;
      }
      return;
    }

    if (this.stateValue === 'CANDIDATE') {
      if (observation.confidence < ENTER_CONFIDENCE) {
        this.reset();
        return;
      }
      if (
        this.candidateSince !== null &&
        observation.timestamp - this.candidateSince >= STABILITY_MS
      ) {
        this.stateValue = 'FIRED';
        this.candidateSince = null;
        this.onActivation(observation);
      }
      return;
    }

    if (this.stateValue === 'FIRED') {
      if (observation.confidence <= EXIT_CONFIDENCE) {
        this.stateValue = 'RELEASING';
        this.releaseSince = observation.timestamp;
      }
      return;
    }

    if (observation.confidence > EXIT_CONFIDENCE) {
      this.stateValue = 'FIRED';
      this.releaseSince = null;
    } else if (
      this.releaseSince !== null &&
      observation.timestamp - this.releaseSince >= RELEASE_MS
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
