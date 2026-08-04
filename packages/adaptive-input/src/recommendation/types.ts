/** Mapping-only recommendation contracts. No button-layout mutation lives here. */

import type {
  ActionId,
  ActionRequirements,
  CalibrationTask,
} from '../actions.ts';
import type { InputChannelId, InputSourceId } from '../sources.ts';

export interface ChannelScore {
  task: CalibrationTask;
  channel: InputChannelId;
  source: InputSourceId;
  trialCount: number;
  successCount: number;
  successRate: number;
  medianLatencyMs: number | null;
  falseActivationCount: number;
  falseActivationObservationMs: number;
  falseActivationsPerMinute: number;
  recordedAt: number;
}

export type MetricComparison =
  | 'current-better'
  | 'alternative-better'
  | 'similar'
  | 'unavailable';

export type OverallComparison =
  | 'current-dominates'
  | 'alternative-dominates'
  | 'trade-off'
  | 'similar';

export interface ChannelScoreComparison {
  success: MetricComparison;
  latency: MetricComparison;
  falseActivations: MetricComparison;
  overall: OverallComparison;
}

interface RecommendationBase<A extends ActionId> {
  action: A;
  task: CalibrationTask;
  from: InputSourceId;
  explanation: string;
}

export interface NeedsCalibrationRecommendation<A extends ActionId = ActionId>
  extends RecommendationBase<A> {
  verdict: 'needs-calibration';
  to: InputSourceId;
  missing: readonly InputSourceId[];
  evidence: null;
}

export interface ComparedRecommendation<A extends ActionId = ActionId>
  extends RecommendationBase<A> {
  verdict: 'keep' | 'swap' | 'trade-off' | 'retest';
  to: InputSourceId | null;
  evidence: {
    current: ChannelScore;
    alternative: ChannelScore;
    comparison: ChannelScoreComparison;
    rule: string;
  };
}

export type Recommendation<A extends ActionId = ActionId> =
  | NeedsCalibrationRecommendation<A>
  | ComparedRecommendation<A>;

export interface RecommendationRequest<A extends ActionId = ActionId> {
  action: A;
  requirements: ActionRequirements;
  currentSource: InputSourceId;
  alternativeSource: InputSourceId;
}

export interface RecommendationResult<A extends ActionId = ActionId> {
  recommendations: Recommendation<A>[];
}

export const RULES = {
  MIN_USABLE_SUCCESS_RATE: 0.5,
  MIN_LATENCY_DIFFERENCE_MS: 100,
  MIN_LATENCY_DIFFERENCE_RATIO: 0.15,
} as const;
