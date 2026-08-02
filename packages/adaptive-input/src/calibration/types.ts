/** Game-independent cue-response calibration records. */

import type { ActionId } from '../actions.ts';
import type { InputChannelId, InputSourceId } from '../sources.ts';

export const ANTICIPATION_FLOOR_MS = 150;
export const RESPONSE_TIMEOUT_MS = 2_000;
export const CUE_DELAY_RANGE_MS: readonly [number, number] = [1_500, 3_500];
export const NO_CUE_WINDOW_MS = 25_000;

export type TrialOutcome = 'success' | 'miss' | 'anticipated';

export interface CalibrationTrial<A extends ActionId = ActionId> {
  trialIndex: number;
  action: A;
  cueAt: number;
  respondedAt: number | null;
  latencyMs: number | null;
  source: InputSourceId | null;
  confidence?: number;
  outcome: TrialOutcome;
  /** Additional activations after the first response; catches held-gesture refires. */
  extraActivations: number;
}

export interface FalseActivation<A extends ActionId = ActionId> {
  action: A;
  source: InputSourceId;
  timestamp: number;
  confidence?: number;
  context: 'pre-cue' | 'no-cue-window';
}

export interface CalibrationSession<A extends ActionId = ActionId> {
  id: string;
  channelUnderTest: InputChannelId;
  action: A;
  startedAt: number;
  trials: CalibrationTrial<A>[];
  falseActivations: FalseActivation<A>[];
  noCueWindowMs: number;
}

export const TRIALS_INITIAL = 12;
export const TRIALS_EXTENDED = 20;
export const EARLY_STOP_GAP = 0.15;
