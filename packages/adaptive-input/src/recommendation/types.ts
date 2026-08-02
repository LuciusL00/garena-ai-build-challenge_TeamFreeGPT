/** Mapping-only recommendation contracts. No button-layout mutation lives here. */

import type { ActionId } from '../actions.ts';
import type { InputChannelId, InputSourceId } from '../sources.ts';

export interface ChannelScore<A extends ActionId = ActionId> {
  action: A;
  channel: InputChannelId;
  source: InputSourceId;
  trials: number;
  successRate: number;
  medianLatencyMs: number;
  falseActivationsPerMinute: number;
}

interface RecommendationBase<A extends ActionId> {
  action: A;
  from: InputSourceId;
  explanation: string;
}

export interface KeepRecommendation<A extends ActionId = ActionId>
  extends RecommendationBase<A> {
  verdict: 'keep';
  to: null;
  evidence: {
    current: ChannelScore<A>;
    alternative?: ChannelScore<A>;
    rule: string;
  };
}

export interface ChangeRecommendation<A extends ActionId = ActionId>
  extends RecommendationBase<A> {
  verdict: 'swap' | 'advise-against';
  to: InputSourceId;
  evidence: {
    current: ChannelScore<A>;
    alternative: ChannelScore<A>;
    rule: string;
  };
}

export type Recommendation<A extends ActionId = ActionId> =
  | KeepRecommendation<A>
  | ChangeRecommendation<A>;

export interface RecommendationResult<A extends ActionId = ActionId> {
  recommendations: Recommendation<A>[];
}

export const RULES = {
  TOUCH_SUCCESS_FLOOR: 0.8,
  MIN_IMPROVEMENT: 0.1,
  MAX_FALSE_ACTIVATIONS_PER_MIN: 1.0,
} as const;
