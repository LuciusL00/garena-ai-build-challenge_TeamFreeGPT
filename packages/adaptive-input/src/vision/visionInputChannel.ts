import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';
import { ChannelUnavailableError, type ChannelContext, type InputChannel } from '../channel.ts';
import { InputChannelId, InputSourceId } from '../sources.ts';
import {
  DEFAULT_GESTURE_COMMAND_CONFIG,
  GestureCommandGate,
  highestConfidenceGestureCommand,
  type GestureCommandGateConfig,
  type GestureCommandGateState,
} from './gestureCommandGate.ts';
import { PointDirectionTracker, type DirectionVector } from './pointDirection.ts';

export const MEDIAPIPE_TASKS_VISION_VERSION = '0.10.35';
export const MEDIAPIPE_WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
export const GESTURE_RECOGNIZER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

export type VisionStatus = 'IDLE' | 'REQUESTING' | 'LOADING' | 'READY' | 'ERROR';
export interface VisionTimingDiagnostic {
  readonly cameraStartupDurationMs: number;
  readonly modelStartupDurationMs: number;
  readonly totalStartupDurationMs: number;
  readonly inferenceDurationMs: number;
  readonly sampleIntervalMs: number | null;
  readonly effectiveFps: number | null;
}
export interface VisionDiagnostic {
  readonly fistState: GestureCommandGateState;
  readonly fistConfidence: number;
  readonly direction: DirectionVector | null;
  readonly commandState: GestureCommandGateState;
  readonly detectedCommand: InputSourceId | null;
  readonly commandConfidence: number;
  readonly timing: VisionTimingDiagnostic;
}
export interface VisionInputChannelOptions {
  readonly inferenceFps?: number;
  /** Bounded, explicit A/B settings. Defaults remain 200/450/150 ms. */
  readonly gestureTiming?: {
    readonly stabilityMs?: number;
    readonly cooldownMs?: number;
    readonly neutralMs?: number;
  };
  readonly onStatus?: (status: VisionStatus, detail: string) => void;
  readonly onDiagnostic?: (diagnostic: VisionDiagnostic) => void;
}

const GESTURE_TIMING_MIN_MS = 0;
const GESTURE_TIMING_MAX_MS = 2_000;

const TRIGGER_DEFINITIONS = [
  { categoryName: 'Closed_Fist', source: InputSourceId.HAND_CLOSED_FIST },
  { categoryName: 'Open_Palm', source: InputSourceId.HAND_OPEN_PALM },
  { categoryName: 'Thumb_Up', source: InputSourceId.HAND_THUMB_UP },
] as const;

export class VisionInputChannel implements InputChannel {
  readonly id = InputChannelId.HAND_VISION;
  readonly sources = [
    InputSourceId.HAND_CLOSED_FIST,
    InputSourceId.HAND_OPEN_PALM,
    InputSourceId.HAND_THUMB_UP,
    InputSourceId.HAND_POINT_DIRECTION,
  ] as const;
  private recognizer: GestureRecognizer | null = null;
  private stream: MediaStream | null = null;
  private timer: number | null = null;
  private context: ChannelContext | null = null;
  private processing = false;
  private pointing = false;
  private startPromise: Promise<void> | null = null;
  private startToken: object | null = null;
  private startGeneration: number | null = null;
  private desiredActive = false;
  private generation = 0;
  private trackEndCleanup: (() => void) | null = null;
  private startupTiming: Omit<
    VisionTimingDiagnostic,
    'inferenceDurationMs' | 'sampleIntervalMs' | 'effectiveFps'
  > | null = null;
  private previousInferenceStartedAt: number | null = null;
  private readonly point = new PointDirectionTracker();
  /** One gate for the currently processed hand; future hands can own separate gates. */
  private readonly commandGate: GestureCommandGate;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly options: VisionInputChannelOptions = {},
  ) {
    this.commandGate = new GestureCommandGate((candidate, timestamp) => {
      this.context?.emit({
        kind: 'trigger',
        source: candidate.source,
        timestamp,
        confidence: candidate.confidence,
      });
    }, gestureCommandConfig(options.gestureTiming));
  }

  get isActive(): boolean {
    return this.timer !== null && this.stream !== null && this.recognizer !== null;
  }

  start(ctx: ChannelContext): Promise<void> {
    this.desiredActive = true;
    if (this.isActive) {
      if (this.pointing) this.emitPointingEnd(performance.now());
      this.commandGate.reset();
      this.point.reset();
      this.context = ctx;
      return Promise.resolve();
    }
    if (this.startPromise && this.startGeneration === this.generation) return this.startPromise;

    const generation = ++this.generation;
    const previousStart = this.startPromise;
    const attempt = (previousStart ? previousStart.catch(() => undefined) : Promise.resolve())
      .then(async () => {
        if (!this.desiredActive || generation !== this.generation) return;
        await this.startInternal(ctx, generation);
      });
    const token = {};
    const tracked = attempt.finally(() => {
      if (this.startToken !== token) return;
      this.startPromise = null;
      this.startToken = null;
      this.startGeneration = null;
    });
    this.startPromise = tracked;
    this.startToken = token;
    this.startGeneration = generation;
    return tracked;
  }

  stop(): void {
    this.desiredActive = false;
    ++this.generation;
    if (this.pointing) this.emitPointingEnd(performance.now());
    this.releaseResources();
    this.report('IDLE', 'Camera stopped. Touch controls remain available.');
  }

  private async startInternal(ctx: ChannelContext, generation: number): Promise<void> {
    this.context = ctx;
    const startupStartedAt = performance.now();
    this.startupTiming = null;
    this.previousInferenceStartedAt = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new ChannelUnavailableError(this.id, 'not-supported', 'This browser does not support camera access.');
      }
      this.report('REQUESTING', 'Waiting for camera permission…');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (!this.isCurrentStart(generation)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      if (!this.isCurrentStart(generation)) {
        stream.getTracks().forEach((track) => track.stop());
        if (this.stream === stream) {
          this.stream = null;
          this.video.srcObject = null;
        }
        return;
      }
      const cameraReadyAt = performance.now();
      this.report('LOADING', 'Loading the on-device hand model…');
      const modelStartedAt = performance.now();
      const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
      const recognizer = await GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: GESTURE_RECOGNIZER_MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
      });
      if (!this.isCurrentStart(generation)) {
        recognizer.close();
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack || videoTrack.readyState === 'ended') {
        recognizer.close();
        throw new ChannelUnavailableError(this.id, 'load-failed', 'The camera stream ended before vision was ready.');
      }
      const modelReadyAt = performance.now();
      this.recognizer = recognizer;
      this.attachTrackEnd(videoTrack, generation);
      this.startupTiming = {
        cameraStartupDurationMs: cameraReadyAt - startupStartedAt,
        modelStartupDurationMs: modelReadyAt - modelStartedAt,
        totalStartupDurationMs: modelReadyAt - startupStartedAt,
      };
      const fps = Math.max(10, Math.min(15, this.options.inferenceFps ?? 12));
      this.timer = window.setInterval(() => this.infer(), 1000 / fps);
      this.report('READY', 'Camera ready. Processing stays on this device.');
    } catch (error: unknown) {
      if (!this.isCurrentStart(generation)) return;
      const denied = error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      const failure = error instanceof ChannelUnavailableError
        ? error
        : new ChannelUnavailableError(
            this.id,
            denied ? 'permission-denied' : 'load-failed',
            denied ? 'Camera permission was denied. Touch controls remain available.' : errorMessage(error),
          );
      this.desiredActive = false;
      ++this.generation;
      this.releaseResources();
      this.report('ERROR', failure.message);
      throw failure;
    }
  }

  private infer(): void {
    if (this.processing || !this.recognizer || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    this.processing = true;
    const inferenceStartedAt = performance.now();
    const sampleIntervalMs = this.previousInferenceStartedAt === null
      ? null
      : inferenceStartedAt - this.previousInferenceStartedAt;
    this.previousInferenceStartedAt = inferenceStartedAt;
    try {
      const result = this.recognizer.recognizeForVideo(this.video, inferenceStartedAt);
      const timestamp = performance.now();
      const inferenceDurationMs = timestamp - inferenceStartedAt;
      const gestures = result.gestures[0] ?? [];
      const candidates = triggerCandidates(gestures);
      const detectedCommand = highestConfidenceGestureCommand(candidates);
      this.commandGate.update(timestamp, detectedCommand);

      let direction: DirectionVector | null = null;
      if (this.commandGate.state !== 'READY') {
        if (this.pointing) this.emitPointingEnd(timestamp);
        else this.point.reset();
      } else {
        direction = result.landmarks[0] ? this.point.update(result.landmarks[0]) : null;
        if (direction) {
          this.pointing = true;
          this.context?.emit({ kind: 'direction', source: InputSourceId.HAND_POINT_DIRECTION, timestamp, direction });
        } else if (this.pointing) {
          this.emitPointingEnd(timestamp);
        }
      }
      const fistConfidence = confidenceFor(candidates, InputSourceId.HAND_CLOSED_FIST);
      const commandState = this.commandGate.state;
      const startupTiming = this.startupTiming;
      if (!startupTiming) throw new Error('Vision startup timing is unavailable.');
      this.options.onDiagnostic?.({
        fistState: this.commandGate.activeSource === InputSourceId.HAND_CLOSED_FIST
          ? commandState
          : 'READY',
        fistConfidence,
        direction,
        commandState,
        detectedCommand: detectedCommand?.source ?? null,
        commandConfidence: detectedCommand?.confidence ?? 0,
        timing: {
          ...startupTiming,
          inferenceDurationMs,
          sampleIntervalMs,
          effectiveFps: sampleIntervalMs === null || sampleIntervalMs <= 0
            ? null
            : 1_000 / sampleIntervalMs,
        },
      });
    } catch (error: unknown) {
      this.failActive(errorMessage(error));
    } finally {
      this.processing = false;
    }
  }

  private emitPointingEnd(timestamp: number): void {
    if (!this.pointing) return;
    this.pointing = false;
    this.point.reset();
    this.context?.emit({ kind: 'direction-end', source: InputSourceId.HAND_POINT_DIRECTION, timestamp });
  }

  private isCurrentStart(generation: number): boolean {
    return this.desiredActive && generation === this.generation;
  }

  private attachTrackEnd(track: MediaStreamTrack, generation: number): void {
    const onEnded = (): void => {
      if (!this.isCurrentStart(generation)) return;
      this.failActive('The camera stream ended. Touch controls remain available.');
    };
    track.addEventListener('ended', onEnded, { once: true });
    this.trackEndCleanup = () => track.removeEventListener('ended', onEnded);
  }

  private failActive(detail: string): void {
    if (!this.desiredActive && !this.isActive && this.stream === null) return;
    this.desiredActive = false;
    ++this.generation;
    if (this.pointing) this.emitPointingEnd(performance.now());
    this.releaseResources();
    this.report('ERROR', detail);
  }

  private releaseResources(): void {
    this.trackEndCleanup?.();
    this.trackEndCleanup = null;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const stream = this.stream;
    this.stream = null;
    stream?.getTracks().forEach((track) => track.stop());
    this.video.srcObject = null;
    const recognizer = this.recognizer;
    this.recognizer = null;
    this.context = null;
    this.pointing = false;
    this.commandGate.reset();
    this.point.reset();
    this.processing = false;
    this.startupTiming = null;
    this.previousInferenceStartedAt = null;
    if (recognizer) {
      try {
        recognizer.close();
      } catch {
        // Resource references are already cleared, so repeated stop remains safe.
      }
    }
  }

  private report(status: VisionStatus, detail: string): void {
    this.options.onStatus?.(status, detail);
  }
}

function triggerCandidates(
  gestures: readonly { readonly categoryName: string; readonly score: number }[],
): readonly { source: InputSourceId; confidence: number }[] {
  return TRIGGER_DEFINITIONS.flatMap(({ categoryName, source }) => {
    const match = gestures.find((gesture) => gesture.categoryName === categoryName);
    return match ? [{ source, confidence: match.score }] : [];
  });
}

function confidenceFor(
  candidates: readonly { source: InputSourceId; confidence: number }[],
  source: InputSourceId,
): number {
  return candidates.find((candidate) => candidate.source === source)?.confidence ?? 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown vision model failure.';
}

function gestureCommandConfig(
  timing: VisionInputChannelOptions['gestureTiming'],
): GestureCommandGateConfig {
  return {
    ...DEFAULT_GESTURE_COMMAND_CONFIG,
    stabilityMs: boundedTiming(
      'stabilityMs',
      timing?.stabilityMs,
      DEFAULT_GESTURE_COMMAND_CONFIG.stabilityMs,
    ),
    cooldownMs: boundedTiming(
      'cooldownMs',
      timing?.cooldownMs,
      DEFAULT_GESTURE_COMMAND_CONFIG.cooldownMs,
    ),
    neutralMs: boundedTiming(
      'neutralMs',
      timing?.neutralMs,
      DEFAULT_GESTURE_COMMAND_CONFIG.neutralMs,
    ),
  };
}

function boundedTiming(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < GESTURE_TIMING_MIN_MS || value > GESTURE_TIMING_MAX_MS) {
    throw new RangeError(`${name} must be between ${GESTURE_TIMING_MIN_MS} and ${GESTURE_TIMING_MAX_MS} ms.`);
  }
  return value;
}
