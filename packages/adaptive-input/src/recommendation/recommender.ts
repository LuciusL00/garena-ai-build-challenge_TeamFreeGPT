/** Transparent mapping recommendations from stored player measurements. */

import type { ActionId } from '../actions.ts';
import type { CalibrationProfile } from '../profile.ts';
import type {
  ChannelScore,
  ChannelScoreComparison,
  MetricComparison,
  Recommendation,
  RecommendationRequest,
} from './types.ts';
import { RULES } from './types.ts';

export class ControlRecommender {
  recommend<A extends ActionId>(
    request: RecommendationRequest<A>,
    profile: CalibrationProfile,
  ): Recommendation<A> {
    const task = request.requirements.task;
    const current = profile.get(task, request.currentSource);
    const alternative = profile.get(task, request.alternativeSource);
    const missing = [
      ...(current ? [] : [request.currentSource]),
      ...(alternative ? [] : [request.alternativeSource]),
    ];

    if (!current || !alternative) {
      return {
        action: request.action,
        task,
        from: request.currentSource,
        to: request.alternativeSource,
        verdict: 'needs-calibration',
        missing,
        evidence: null,
        explanation: 'Test both the current and alternative inputs before comparing them.',
      };
    }

    const comparison = compareChannelScores(current, alternative);
    const evidence = { current, alternative, comparison };

    if (
      current.successRate < RULES.MIN_USABLE_SUCCESS_RATE &&
      alternative.successRate < RULES.MIN_USABLE_SUCCESS_RATE
    ) {
      return {
        action: request.action,
        task,
        from: request.currentSource,
        to: null,
        verdict: 'retest',
        evidence: { ...evidence, rule: 'both-sources-low-success' },
        explanation:
          'Both controls missed more than half of the cues. Retest before changing the mapping.',
      };
    }

    if (comparison.overall === 'alternative-dominates') {
      return {
        action: request.action,
        task,
        from: request.currentSource,
        to: request.alternativeSource,
        verdict: 'swap',
        evidence: { ...evidence, rule: 'alternative-dominates' },
        explanation:
          'The alternative input was meaningfully better in at least one measured area ' +
          'and was not worse in the others.',
      };
    }

    if (comparison.overall === 'trade-off') {
      return {
        action: request.action,
        task,
        from: request.currentSource,
        to: null,
        verdict: 'trade-off',
        evidence: { ...evidence, rule: 'mixed-measurements' },
        explanation:
          'Each control performed better in a different area. Review the table and choose the ' +
          'trade-off you prefer.',
      };
    }

    const currentDominates = comparison.overall === 'current-dominates';
    return {
      action: request.action,
      task,
      from: request.currentSource,
      to: null,
      verdict: 'keep',
      evidence: {
        ...evidence,
        rule: currentDominates ? 'current-dominates' : 'no-measured-advantage',
      },
      explanation: currentDominates
        ? 'The current input was meaningfully better in at least one measured area and was not ' +
          'worse in the others.'
        : 'The controls measured similarly. Keep the original control unless you personally prefer the alternative.',
    };
  }
}

/**
 * Declares a winner only when it has no measured disadvantage. Mixed results
 * remain a player-visible trade-off instead of being hidden by one total score.
 */
export function compareChannelScores(
  current: ChannelScore,
  alternative: ChannelScore,
): ChannelScoreComparison {
  const success = compareHigherIsBetter(current.successRate, alternative.successRate);
  const latency = compareLatency(current.medianLatencyMs, alternative.medianLatencyMs);
  const falseActivations = compareLowerIsBetter(
    current.falseActivationsPerMinute,
    alternative.falseActivationsPerMinute,
  );
  const measured = [success, latency, falseActivations].filter(
    (value): value is Exclude<MetricComparison, 'unavailable'> => value !== 'unavailable',
  );
  const currentHasAdvantage = measured.includes('current-better');
  const alternativeHasAdvantage = measured.includes('alternative-better');

  let overall: ChannelScoreComparison['overall'] = 'similar';
  if (currentHasAdvantage && alternativeHasAdvantage) overall = 'trade-off';
  else if (currentHasAdvantage) overall = 'current-dominates';
  else if (alternativeHasAdvantage) overall = 'alternative-dominates';

  return { success, latency, falseActivations, overall };
}

function compareHigherIsBetter(current: number, alternative: number): MetricComparison {
  if (current === alternative) return 'similar';
  return current > alternative ? 'current-better' : 'alternative-better';
}

function compareLowerIsBetter(current: number, alternative: number): MetricComparison {
  if (current === alternative) return 'similar';
  return current < alternative ? 'current-better' : 'alternative-better';
}

function compareLatency(
  current: number | null,
  alternative: number | null,
): MetricComparison {
  if (current === null || alternative === null) return 'unavailable';
  const difference = Math.abs(current - alternative);
  const meaningfulDifference = Math.max(
    RULES.MIN_LATENCY_DIFFERENCE_MS,
    Math.min(current, alternative) * RULES.MIN_LATENCY_DIFFERENCE_RATIO,
  );
  if (difference < meaningfulDifference) return 'similar';
  return current < alternative ? 'current-better' : 'alternative-better';
}
