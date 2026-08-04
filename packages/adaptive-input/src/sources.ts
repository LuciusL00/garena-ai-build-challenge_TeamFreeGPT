/** Input sources, their lifecycle-owning channels, and their common signal. */

export enum InputChannelId {
  TOUCH = 'TOUCH',
  HAND_VISION = 'HAND_VISION',
  /** Designed, not delivered. */
  FACE_VISION = 'FACE_VISION',
}

export enum InputSourceId {
  TOUCH_POINTER = 'TOUCH_POINTER',
  TOUCH_BUTTON = 'TOUCH_BUTTON',
  /** A touch drag or directional control that supplies a relative vector. */
  TOUCH_DIRECTION = 'TOUCH_DIRECTION',

  HAND_CLOSED_FIST = 'HAND_CLOSED_FIST',
  HAND_OPEN_PALM = 'HAND_OPEN_PALM',
  HAND_VICTORY = 'HAND_VICTORY',
  HAND_POINTING_UP = 'HAND_POINTING_UP',
  /** Pointing direction derived from hand landmarks, not a game movement command. */
  HAND_POINT_DIRECTION = 'HAND_POINT_DIRECTION',

  /** Designed, not delivered. */
  FACE_JAW_OPEN = 'FACE_JAW_OPEN',
}

const SOURCE_CHANNEL: Record<InputSourceId, InputChannelId> = {
  [InputSourceId.TOUCH_POINTER]: InputChannelId.TOUCH,
  [InputSourceId.TOUCH_BUTTON]: InputChannelId.TOUCH,
  [InputSourceId.TOUCH_DIRECTION]: InputChannelId.TOUCH,
  [InputSourceId.HAND_CLOSED_FIST]: InputChannelId.HAND_VISION,
  [InputSourceId.HAND_OPEN_PALM]: InputChannelId.HAND_VISION,
  [InputSourceId.HAND_VICTORY]: InputChannelId.HAND_VISION,
  [InputSourceId.HAND_POINTING_UP]: InputChannelId.HAND_VISION,
  [InputSourceId.HAND_POINT_DIRECTION]: InputChannelId.HAND_VISION,
  [InputSourceId.FACE_JAW_OPEN]: InputChannelId.FACE_VISION,
};

export function channelOf(source: InputSourceId): InputChannelId {
  return SOURCE_CHANNEL[source];
}

/** Identifies where an emission belongs in a before/after evaluation. */
export type MeasurementPhase = 'gameplay' | 'baseline' | 'calibration' | 'validation';

/**
 * The game-independent envelope every channel emits.
 *
 * A channel reports what happened. It never names a game action or constructs
 * a game payload; the host adapter performs that translation.
 */
interface InputSignalBase {
  source: InputSourceId;
  /** Monotonic timestamp supplied by the platform adapter. */
  timestamp: number;
  /** Recognition confidence, from 0 to 1, when the source provides one. */
  confidence?: number;
  /** Optional evaluation context; omitted during ordinary unmeasured play. */
  sessionId?: string;
  phase?: MeasurementPhase;
}

/** A one-shot input such as a button press or closed-fist activation. */
export interface TriggerInputSignal extends InputSignalBase {
  kind: 'trigger';
}

/** An absolute normalized position. Hosts convert 0..1 values to game space. */
export interface PointInputSignal extends InputSignalBase {
  kind: 'point';
  point: { x: number; y: number };
}

/** A relative direction. Components should be normalized to the -1..1 range. */
export interface DirectionInputSignal extends InputSignalBase {
  kind: 'direction';
  direction: { x: number; y: number };
}

export type InputSignal = TriggerInputSignal | PointInputSignal | DirectionInputSignal;

/** Metadata attached after a host adapter translates a signal to an action. */
export type EmissionMeta = InputSignal;
