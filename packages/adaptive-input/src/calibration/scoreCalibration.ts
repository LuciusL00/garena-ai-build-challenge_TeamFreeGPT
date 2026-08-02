/** Converts one completed calibration session into reusable channel evidence. */

import type { ActionId } from '../actions.ts';
import type { ChannelScore } from '../recommendation/types.ts';
import type { CalibrationSession } from './types.ts';

export function scoreCalibration<A extends ActionId>(
  session: CalibrationSession<A>,
  recordedAt: number = Date.now(),
): ChannelScore {
  const successfulLatencies = session.trials
    .filter(
      (trial) =>
        trial.outcome === 'success' &&
        trial.latencyMs !== null &&
        trial.source === session.sourceUnderTest,
    )
    .map((trial) => trial.latencyMs as number)
    .sort((left, right) => left - right);
  const successes = successfulLatencies.length;
  const falseActivationCount = session.falseActivations.filter(
    (activation) => activation.source === session.sourceUnderTest,
  ).length;
  const falseActivationObservationMs = session.trials.reduce(
    (total, trial) => total + Math.max(0, trial.cueAt - trial.waitingStartedAt),
    0,
  );

  return {
    task: session.task,
    channel: session.channelUnderTest,
    source: session.sourceUnderTest,
    trialCount: session.trials.length,
    successCount: successes,
    successRate: session.trials.length === 0 ? 0 : successes / session.trials.length,
    medianLatencyMs: median(successfulLatencies),
    falseActivationCount,
    falseActivationObservationMs,
    falseActivationsPerMinute:
      falseActivationObservationMs === 0
        ? 0
        : (falseActivationCount * 60_000) / falseActivationObservationMs,
    recordedAt,
  };
}

function median(sortedValues: readonly number[]): number | null {
  if (sortedValues.length === 0) return null;
  const middle = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) return sortedValues[middle];
  return (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}
