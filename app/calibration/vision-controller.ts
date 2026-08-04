/** Browser camera integration adapted from Vivin's standalone prototype. */

import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';
import { ClosedFistGate, type ClosedFistGateState } from './closed-fist-gate.ts';

const MEDIAPIPE_WASM =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const GESTURE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

export type VisionStatus =
  | 'IDLE'
  | 'REQUESTING'
  | 'LOADING'
  | 'READY'
  | 'DENIED'
  | 'UNAVAILABLE'
  | 'ERROR';

export interface VisionCallbacks {
  onStatus(status: VisionStatus, detail?: string): void;
  onFistActivation(timestamp: number, confidence: number): void;
  onFistState(state: ClosedFistGateState, confidence: number): void;
}

export class VisionController {
  private recognizer: GestureRecognizer | null = null;
  private stream: MediaStream | null = null;
  private timer: number | null = null;
  private processing = false;
  private readonly fist: ClosedFistGate;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly callbacks: VisionCallbacks,
  ) {
    this.fist = new ClosedFistGate(({ timestamp, confidence }) =>
      callbacks.onFistActivation(timestamp, confidence),
    );
  }

  async start(): Promise<void> {
    this.stop(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      this.callbacks.onStatus('UNAVAILABLE', 'This browser does not support camera access.');
      return;
    }

    try {
      this.callbacks.onStatus('REQUESTING', 'Waiting for camera permission…');
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();

      this.callbacks.onStatus('LOADING', 'Loading the on-device gesture model…');
      const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
      this.recognizer = await GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: GESTURE_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
      });
      this.callbacks.onStatus('READY', 'Camera ready. Open your hand between fist activations.');
      this.timer = window.setInterval(() => this.infer(), 1000 / 12);
    } catch (error: unknown) {
      const denied =
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      this.stop(false);
      this.callbacks.onStatus(
        denied ? 'DENIED' : 'ERROR',
        denied
          ? 'Camera permission was denied. Touch calibration remains available.'
          : errorMessage(error),
      );
    }
  }

  stop(reportIdle = true): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.recognizer?.close();
    this.recognizer = null;
    this.processing = false;
    this.fist.reset();
    this.callbacks.onFistState('OPEN', 0);
    if (reportIdle) this.callbacks.onStatus('IDLE', 'Camera stopped.');
  }

  private infer(): void {
    if (
      this.processing ||
      !this.recognizer ||
      this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return;
    }

    this.processing = true;
    try {
      const timestamp = performance.now();
      const result = this.recognizer.recognizeForVideo(this.video, timestamp);
      const confidence =
        result.gestures[0]?.find((category) => category.categoryName === 'Closed_Fist')?.score ??
        0;
      this.fist.update({ timestamp, confidence });
      this.callbacks.onFistState(this.fist.state, confidence);
    } catch (error: unknown) {
      this.callbacks.onStatus('ERROR', errorMessage(error));
    } finally {
      this.processing = false;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown vision error.';
}
