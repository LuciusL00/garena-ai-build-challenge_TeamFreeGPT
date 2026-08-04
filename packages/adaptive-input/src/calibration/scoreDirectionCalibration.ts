import type { ChannelScore } from '../recommendation/types.ts';
import type { DirectionCalibrationSession } from './directionHarness.ts';

export function scoreDirectionCalibration(
  session: DirectionCalibrationSession,
  recordedAt: number = Date.now(),
): ChannelScore {
  const successful = session.trials.filter((trial) => trial.outcome === 'success');
  const latencies = successful.flatMap((trial) => trial.latencyMs === null ? [] : [trial.latencyMs]).sort((a, b) => a - b);
  const errors = successful.flatMap((trial) => trial.angularErrorDeg === null ? [] : [trial.angularErrorDeg]);
  return {
    task: 'DIRECTION',
    channel: session.channelUnderTest,
    source: session.sourceUnderTest,
    trialCount: session.trials.length,
    successCount: successful.length,
    successRate: session.trials.length === 0 ? 0 : successful.length / session.trials.length,
    medianLatencyMs: median(latencies),
    falseActivationCount: 0,
    falseActivationObservationMs: 0,
    falseActivationsPerMinute: 0,
    directionMetrics: {
      meanAngularErrorDeg: mean(errors),
      meanJitterDeg: mean(session.trials.map((trial) => trial.jitterDeg)),
      dropoutCount: session.trials.reduce((sum, trial) => sum + trial.dropoutCount, 0),
    },
    recordedAt,
  };
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}
