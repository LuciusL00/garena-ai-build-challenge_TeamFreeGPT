/** Transparent mapping recommendations from stored player measurements. */

import type { ActionId, ActionRequirements } from '../actions.ts';
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

    const comparison = compareChannelScores(current, alternative, request.requirements);
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

    const missingRequiredEvidence = requiredEvidenceGap(request.requirements, comparison);
    if (missingRequiredEvidence) {
      return {
        action: request.action,
        task,
        from: request.currentSource,
        to: null,
        verdict: 'retest',
        evidence: { ...evidence, rule: missingRequiredEvidence.rule },
        explanation: missingRequiredEvidence.explanation,
      };
    }

    const requirementNote = explainRequirements(
      request.requirements,
      comparison,
      current,
      alternative,
    );

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
          `and was not worse in the others.${requirementNote}`,
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
          `trade-off you prefer.${requirementNote}`,
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
          `worse in the others.${requirementNote}`
        : 'The controls measured similarly. Keep the original control unless you personally ' +
          `prefer the alternative.${requirementNote}`,
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
  requirements: ActionRequirements = {
    task: current.task,
    spatial: false,
    latencyCritical: false,
  },
): ChannelScoreComparison {
  const success = compareSuccess(current, alternative);
  const latency = compareLatency(current.medianLatencyMs, alternative.medianLatencyMs);
  const falseActivations = compareFalseActivations(current, alternative);
  const directionRelevant = requirements.task === 'DIRECTION' || requirements.spatial;
  const angularError = compareDirectionMetric(
    current,
    alternative,
    'meanAngularErrorDeg',
    RULES.MIN_ANGULAR_ERROR_DIFFERENCE_DEG,
    RULES.MIN_ANGULAR_ERROR_DIFFERENCE_RATIO,
    directionRelevant,
  );
  const jitter = compareDirectionMetric(
    current,
    alternative,
    'meanJitterDeg',
    RULES.MIN_JITTER_DIFFERENCE_DEG,
    RULES.MIN_JITTER_DIFFERENCE_RATIO,
    directionRelevant,
  );
  const dropouts = compareDropouts(current, alternative, directionRelevant);
  const measured = [success, latency, falseActivations, angularError, jitter, dropouts].filter(
    (value): value is Exclude<MetricComparison, 'unavailable'> => value !== 'unavailable',
  );
  const currentHasAdvantage = measured.includes('current-better');
  const alternativeHasAdvantage = measured.includes('alternative-better');

  let overall: ChannelScoreComparison['overall'] = 'similar';
  if (currentHasAdvantage && alternativeHasAdvantage) overall = 'trade-off';
  else if (currentHasAdvantage) overall = 'current-dominates';
  else if (alternativeHasAdvantage) overall = 'alternative-dominates';

  return { success, latency, falseActivations, angularError, jitter, dropouts, overall };
}

function compareSuccess(current: ChannelScore, alternative: ChannelScore): MetricComparison {
  const comparableTrials = Math.min(current.trialCount, alternative.trialCount);
  if (comparableTrials <= 0) return 'unavailable';
  const difference = Math.abs(current.successRate - alternative.successRate);
  const meaningfulDifference = Math.min(
    1,
    RULES.MIN_SUCCESS_DIFFERENCE_TRIALS / comparableTrials,
  );
  if (difference < meaningfulDifference) return 'similar';
  return current.successRate > alternative.successRate
    ? 'current-better'
    : 'alternative-better';
}

function compareFalseActivations(
  current: ChannelScore,
  alternative: ChannelScore,
): MetricComparison {
  if (
    current.falseActivationObservationMs < RULES.MIN_FALSE_ACTIVATION_OBSERVATION_MS ||
    alternative.falseActivationObservationMs < RULES.MIN_FALSE_ACTIVATION_OBSERVATION_MS
  ) {
    return 'unavailable';
  }
  const countDifference = Math.abs(
    current.falseActivationCount - alternative.falseActivationCount,
  );
  if (countDifference < RULES.MIN_FALSE_ACTIVATION_COUNT_DIFFERENCE) return 'similar';
  if (current.falseActivationsPerMinute === alternative.falseActivationsPerMinute) return 'similar';
  return current.falseActivationsPerMinute < alternative.falseActivationsPerMinute
    ? 'current-better'
    : 'alternative-better';
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

function compareDirectionMetric(
  current: ChannelScore,
  alternative: ChannelScore,
  metric: 'meanAngularErrorDeg' | 'meanJitterDeg',
  minimumDifference: number,
  minimumRatio: number,
  relevant: boolean,
): MetricComparison {
  if (!relevant || !current.directionMetrics || !alternative.directionMetrics) {
    return 'unavailable';
  }
  return compareLowerWithThreshold(
    current.directionMetrics[metric],
    alternative.directionMetrics[metric],
    minimumDifference,
    minimumRatio,
  );
}

function compareDropouts(
  current: ChannelScore,
  alternative: ChannelScore,
  relevant: boolean,
): MetricComparison {
  if (!relevant || !current.directionMetrics || !alternative.directionMetrics) {
    return 'unavailable';
  }
  const difference = Math.abs(
    current.directionMetrics.dropoutCount - alternative.directionMetrics.dropoutCount,
  );
  if (difference < RULES.MIN_DROPOUT_DIFFERENCE) return 'similar';
  return current.directionMetrics.dropoutCount < alternative.directionMetrics.dropoutCount
    ? 'current-better'
    : 'alternative-better';
}

function compareLowerWithThreshold(
  current: number,
  alternative: number,
  minimumDifference: number,
  minimumRatio: number,
): MetricComparison {
  const difference = Math.abs(current - alternative);
  const meaningfulDifference = Math.max(
    minimumDifference,
    Math.min(current, alternative) * minimumRatio,
  );
  if (difference < meaningfulDifference) return 'similar';
  return current < alternative ? 'current-better' : 'alternative-better';
}

function requiredEvidenceGap(
  requirements: ActionRequirements,
  comparison: ChannelScoreComparison,
): { rule: string; explanation: string } | null {
  if (requirements.latencyCritical && comparison.latency === 'unavailable') {
    return {
      rule: 'latency-evidence-unavailable',
      explanation:
        'This action is latency-sensitive, but comparable response-time evidence is unavailable. ' +
        'Retest before relying on an automatic recommendation.',
    };
  }
  if (
    requirements.spatial &&
    comparison.angularError === 'unavailable' &&
    comparison.jitter === 'unavailable'
  ) {
    return {
      rule: 'spatial-evidence-unavailable',
      explanation:
        'This action needs spatial precision, but comparable direction-quality evidence is ' +
        'unavailable. Retest with a compatible precision task before deciding.',
    };
  }
  return null;
}

function explainRequirements(
  requirements: ActionRequirements,
  comparison: ChannelScoreComparison,
  current: ChannelScore,
  alternative: ChannelScore,
): string {
  const notes: string[] = [];
  if (requirements.latencyCritical && comparison.latency !== 'unavailable') {
    if (comparison.latency === 'current-better') {
      notes.push(` This action is latency-sensitive; the original measured ${latencyGap(current, alternative)} faster.`);
    } else if (comparison.latency === 'alternative-better') {
      notes.push(` This action is latency-sensitive; the alternative measured ${latencyGap(current, alternative)} faster.`);
    } else {
      notes.push(' This action is latency-sensitive, and the measured response times were similar.');
    }
  }
  if (requirements.spatial) {
    const precision = [comparison.angularError, comparison.jitter, comparison.dropouts];
    const currentAdvantage = precision.includes('current-better');
    const alternativeAdvantage = precision.includes('alternative-better');
    if (currentAdvantage && alternativeAdvantage) {
      notes.push(' Spatial-quality measurements were mixed.');
    } else if (currentAdvantage) {
      notes.push(' The original measured more precise or stable for this spatial action.');
    } else if (alternativeAdvantage) {
      notes.push(' The alternative measured more precise or stable for this spatial action.');
    } else {
      notes.push(' Spatial-quality measurements were similar.');
    }
  }
  return notes.join('');
}

function latencyGap(current: ChannelScore, alternative: ChannelScore): string {
  if (current.medianLatencyMs === null || alternative.medianLatencyMs === null) return 'similarly';
  return `${Math.round(Math.abs(current.medianLatencyMs - alternative.medianLatencyMs))} ms`;
}
