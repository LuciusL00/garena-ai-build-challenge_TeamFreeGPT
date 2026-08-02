export interface ActivationEvent {
  readonly source: string;
  readonly timestamp: number;
  readonly confidence?: number;
}

export interface CalibrationSource {
  readonly id: string;
  subscribe(listener: (event: ActivationEvent) => void): () => void;
}

export interface Clock {
  now(): number;
}

export const monotonicClock: Clock = {
  now: () => performance.now(),
};
