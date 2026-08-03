/** Public API. Host games and input implementations import only from here. */

export type {
  ActionId,
  ActionKey,
  ActionRequirements,
  ActionDescriptor,
  CalibrationTask,
} from './actions.ts';
export { DEFAULT_REQUIREMENTS } from './actions.ts';

export { InputChannelId, InputSourceId, channelOf } from './sources.ts';
export type {
  InputSignal,
  TriggerInputSignal,
  PointInputSignal,
  DirectionInputSignal,
  EmissionMeta,
  MeasurementPhase,
} from './sources.ts';

export { AdaptiveInput } from './bus.ts';
export { BindingMap } from './bindings.ts';
export type { BindingChangeListener } from './bindings.ts';

export { TelemetryRecorder } from './telemetry.ts';
export type { EmissionRecord } from './telemetry.ts';

export {
  ChannelManager,
  ChannelUnavailableError,
} from './channel.ts';
export type {
  ChannelContext,
  ChannelStartFailure,
  InputChannel,
} from './channel.ts';

export * from './calibration/types.ts';
export * from './calibration/harness.ts';
export * from './calibration/scoreCalibration.ts';
export * from './profile.ts';
export * from './recommendation/types.ts';
export * from './recommendation/recommender.ts';
export * from './settings.ts';
