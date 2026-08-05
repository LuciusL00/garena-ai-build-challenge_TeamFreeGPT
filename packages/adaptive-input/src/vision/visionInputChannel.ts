import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';
import { ChannelUnavailableError, type ChannelContext, type InputChannel } from '../channel.ts';
import { InputChannelId, InputSourceId } from '../sources.ts';
import { ClosedFistGate, type ClosedFistGateState } from './closedFistGate.ts';
import { GestureCommandGate, type GestureCommandGateState } from './gestureCommandGate.ts';
import { PointDirectionTracker, type DirectionVector } from './pointDirection.ts';

export const MEDIAPIPE_TASKS_VISION_VERSION = '0.10.35';
export const MEDIAPIPE_WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
export const GESTURE_RECOGNIZER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

export type VisionStatus = 'IDLE' | 'REQUESTING' | 'LOADING' | 'READY' | 'ERROR';
export interface VisionDiagnostic {
  readonly fistState: ClosedFistGateState;
  readonly fistConfidence: number;
  readonly direction: DirectionVector | null;
  readonly commandState: GestureCommandGateState;
  readonly detectedCommand: InputSourceId | null;
  readonly commandConfidence: number;
}
export interface VisionInputChannelOptions {
  readonly inferenceFps?: number;
  readonly onStatus?: (status: VisionStatus, detail: string) => void;
  readonly onDiagnostic?: (diagnostic: VisionDiagnostic) => void;
}

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
  private generation = 0;
  private readonly point = new PointDirectionTracker();
  private readonly fist = new ClosedFistGate(({ timestamp, confidence }) => {
    void timestamp;
    void confidence;
  });
  private readonly commands = new GestureCommandGate((candidate, timestamp) => {
    this.context?.emit({ kind: 'trigger', source: candidate.source, timestamp, confidence: candidate.confidence });
  });

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly options: VisionInputChannelOptions = {},
  ) {}

  get isActive(): boolean {
    return this.timer !== null && this.stream !== null && this.recognizer !== null;
  }

  start(ctx: ChannelContext): Promise<void> {
    if (this.isActive) {
      if (this.pointing) this.emitPointingEnd(performance.now());
      this.fist.reset();
      this.commands.reset();
      this.point.reset();
      this.context = ctx;
      return Promise.resolve();
    }
    if (this.startPromise) return this.startPromise;
    const generation = ++this.generation;
    this.startPromise = this.startInternal(ctx, generation).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  stop(): void {
    ++this.generation;
    if (this.pointing) this.emitPointingEnd(performance.now());
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.recognizer?.close();
    this.recognizer = null;
    this.context = null;
    this.processing = false;
    this.pointing = false;
    this.fist.reset();
    this.commands.reset();
    this.point.reset();
    this.report('IDLE', 'Camera stopped. Touch controls remain available.');
  }

  private async startInternal(ctx: ChannelContext, generation: number): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new ChannelUnavailableError(this.id, 'not-supported', 'This browser does not support camera access.');
    }
    this.context = ctx;
    try {
      this.report('REQUESTING', 'Waiting for camera permission…');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      this.report('LOADING', 'Loading the on-device hand model…');
      const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
      const recognizer = await GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: GESTURE_RECOGNIZER_MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
      });
      if (generation !== this.generation) {
        recognizer.close();
        return;
      }
      this.recognizer = recognizer;
      this.report('READY', 'Camera ready. Processing stays on this device.');
      const fps = Math.max(10, Math.min(15, this.options.inferenceFps ?? 12));
      this.timer = window.setInterval(() => this.infer(), 1000 / fps);
    } catch (error: unknown) {
      const denied = error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      this.releaseAfterFailure();
      const failure = error instanceof ChannelUnavailableError
        ? error
        : new ChannelUnavailableError(
            this.id,
            denied ? 'permission-denied' : 'load-failed',
            denied ? 'Camera permission was denied. Touch controls remain available.' : errorMessage(error),
          );
      this.report('ERROR', failure.message);
      throw failure;
    }
  }

  private infer(): void {
    if (this.processing || !this.recognizer || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    this.processing = true;
    try {
      const timestamp = performance.now();
      const result = this.recognizer.recognizeForVideo(this.video, timestamp);
      const fistConfidence = result.gestures[0]?.find((item) => item.categoryName === 'Closed_Fist')?.score ?? 0;
      this.fist.update({ timestamp, confidence: fistConfidence });
      const detectedCommand = commandCandidate(result.gestures[0] ?? []);
      this.commands.update(timestamp, detectedCommand);
      const direction = result.landmarks[0] ? this.point.update(result.landmarks[0]) : null;
      if (direction && this.commands.state === 'READY') {
        this.pointing = true;
        this.context?.emit({ kind: 'direction', source: InputSourceId.HAND_POINT_DIRECTION, timestamp, direction });
      } else if (this.pointing) {
        this.emitPointingEnd(timestamp);
      }
      this.options.onDiagnostic?.({
        fistState: this.fist.state,
        fistConfidence,
        direction,
        commandState: this.commands.state,
        detectedCommand: detectedCommand?.source ?? null,
        commandConfidence: detectedCommand?.confidence ?? 0,
      });
    } catch (error: unknown) {
      if (this.pointing) this.emitPointingEnd(performance.now());
      this.report('ERROR', errorMessage(error));
      this.releaseAfterFailure();
    } finally {
      this.processing = false;
    }
  }

  private emitPointingEnd(timestamp: number): void {
    this.context?.emit({ kind: 'direction-end', source: InputSourceId.HAND_POINT_DIRECTION, timestamp });
    this.pointing = false;
    this.point.reset();
  }

  private releaseAfterFailure(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.recognizer?.close();
    this.recognizer = null;
    this.context = null;
    this.pointing = false;
    this.fist.reset();
    this.commands.reset();
    this.point.reset();
  }

  private report(status: VisionStatus, detail: string): void {
    this.options.onStatus?.(status, detail);
  }
}

function commandCandidate(
  gestures: readonly { readonly categoryName: string; readonly score: number }[],
): { source: InputSourceId; confidence: number } | null {
  const definitions = [
    ['Closed_Fist', InputSourceId.HAND_CLOSED_FIST],
    ['Open_Palm', InputSourceId.HAND_OPEN_PALM],
    ['Thumb_Up', InputSourceId.HAND_THUMB_UP],
  ] as const;
  const candidates = definitions.flatMap(([categoryName, source]) => {
    const match = gestures.find((gesture) => gesture.categoryName === categoryName);
    return match ? [{ source, confidence: match.score }] : [];
  });
  return candidates.sort((left, right) => right.confidence - left.confidence)[0] ?? null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown vision model failure.';
}
