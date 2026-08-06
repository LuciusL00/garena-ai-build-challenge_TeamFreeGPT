import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';
import { ChannelUnavailableError, type ChannelContext, type InputChannel } from '../channel.ts';
import {
  VISION_INFERENCE_FPS_OPTIONS,
  type VisionInferenceFps,
  type VisionTriggerSource,
} from '../profile.ts';
import { InputChannelId, InputSourceId } from '../sources.ts';
import {
  DEFAULT_GESTURE_COMMAND_CONFIG,
  GestureCommandGate,
  highestConfidenceGestureCommand,
  type GestureCommandGateConfig,
  type GestureCommandGateState,
} from './gestureCommandGate.ts';
import {
  DEFAULT_POINT_STABILITY_MS,
  PointDirectionTracker,
  pointStabilityConfig,
  type DirectionVector,
} from './pointDirection.ts';

export const MEDIAPIPE_TASKS_VISION_VERSION = '0.10.35';
export const MEDIAPIPE_WASM_URL = '/mediapipe/wasm';
export const GESTURE_RECOGNIZER_MODEL_URL =
  '/mediapipe/models/gesture_recognizer.task';

const DEFAULT_INFERENCE_FPS: VisionInferenceFps = 15;

export type VisionStatus = 'IDLE' | 'REQUESTING' | 'LOADING' | 'READY' | 'ERROR';
export interface VisionTimingDiagnostic {
  readonly cameraStartupDurationMs: number;
  readonly modelStartupDurationMs: number;
  readonly totalStartupDurationMs: number;
  readonly inferenceDurationMs: number;
  readonly sampleIntervalMs: number | null;
  readonly effectiveFps: number | null;
  readonly requestedFps: VisionInferenceFps;
}
export interface VisionDiagnostic {
  readonly fistState: GestureCommandGateState;
  readonly fistConfidence: number;
  readonly direction: DirectionVector | null;
  readonly commandState: GestureCommandGateState;
  readonly detectedCommand: InputSourceId | null;
  /** Trigger command that passed confidence, stability and neutral re-arm gating. */
  readonly confirmedCommand: InputSourceId | null;
  readonly commandConfidence: number;
  /** Raw confidence for focusTriggerSource(), before stability/cooldown gating. */
  readonly focusedCommandConfidence: number;
  /** Raw pointing shape recognition for this frame, before any grace period. */
  readonly pointShapeObserved: boolean;
  readonly timing: VisionTimingDiagnostic;
}
export interface VisionInputChannelOptions {
  readonly inferenceFps?: VisionInferenceFps;
  /** How long pointing survives a recognition gap. Defaults to 180 ms. */
  readonly pointStabilityMs?: number;
  /** Bounded, explicit A/B settings. Defaults remain 200/450/150 ms. */
  readonly gestureTiming?: {
    readonly stabilityMs?: number;
    readonly stabilityMsBySource?: Readonly<Partial<Record<VisionTriggerSource, number>>>;
    readonly cooldownMs?: number;
    readonly neutralMs?: number;
  };
  readonly onStatus?: (status: VisionStatus, detail: string) => void;
  readonly onDiagnostic?: (diagnostic: VisionDiagnostic) => void;
}

export interface VisionFrameRateProbeResult {
  readonly requestedFps: VisionInferenceFps;
  readonly effectiveFps: number;
  readonly medianInferenceDurationMs: number;
  readonly sampleCount: number;
}

const FRAME_PROBE_WARMUP_MS = 300;
const FRAME_PROBE_SAMPLE_MS = 1_200;

/** Chooses the highest rate that kept up with its target and frame-time budget. */
export function recommendVisionInferenceFps(
  results: readonly VisionFrameRateProbeResult[],
): VisionInferenceFps | null {
  const sustainable = results
    .filter((result) => {
      const frameBudgetMs = 1_000 / result.requestedFps;
      return result.sampleCount >= 5 &&
        result.effectiveFps >= result.requestedFps * 0.85 &&
        result.medianInferenceDurationMs <= frameBudgetMs * 0.8;
    })
    .sort((left, right) => right.requestedFps - left.requestedFps);
  return sustainable[0]?.requestedFps ?? null;
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
    'inferenceDurationMs' | 'sampleIntervalMs' | 'effectiveFps' | 'requestedFps'
  > | null = null;
  private previousInferenceStartedAt: number | null = null;
  private probeSamples: VisionTimingDiagnostic[] | null = null;
  private probing = false;
  private triggerFocus: InputSourceId | null = null;
  private inferenceFps: VisionInferenceFps;
  private readonly point: PointDirectionTracker;
  /** One gate for the currently processed hand; future hands can own separate gates. */
  private readonly commandGate: GestureCommandGate;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly options: VisionInputChannelOptions = {},
  ) {
    this.inferenceFps = readInferenceFps(options.inferenceFps ?? DEFAULT_INFERENCE_FPS);
    this.point = new PointDirectionTracker(
      pointStabilityConfig(
        boundedTiming('pointStabilityMs', options.pointStabilityMs, DEFAULT_POINT_STABILITY_MS),
      ),
    );
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

  get focusedTriggerSource(): InputSourceId | null {
    return this.triggerFocus;
  }

  get requestedInferenceFps(): VisionInferenceFps {
    return this.inferenceFps;
  }

  setInferenceFps(fps: VisionInferenceFps): void {
    this.inferenceFps = readInferenceFps(fps);
    this.previousInferenceStartedAt = null;
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.scheduleInference();
  }

  /**
   * Measures what this device actually sustains at each supported rate. The
   * channel owns its own frame timing, so hosts never assemble this themselves.
   * The requested rate is restored afterwards; applying a result is the caller's
   * decision.
   */
  async measureInferenceFps(
    options: readonly VisionInferenceFps[] = VISION_INFERENCE_FPS_OPTIONS,
  ): Promise<readonly VisionFrameRateProbeResult[]> {
    if (!this.isActive) {
      throw new ChannelUnavailableError(
        this.id,
        'not-supported',
        'The camera must be running before its speed can be measured.',
      );
    }
    if (this.probing) throw new Error('A camera speed measurement is already running.');
    this.probing = true;
    const originalFps = this.inferenceFps;
    const results: VisionFrameRateProbeResult[] = [];
    try {
      for (const fps of options) {
        this.setInferenceFps(fps);
        await delay(FRAME_PROBE_WARMUP_MS);
        if (!this.isActive || !this.probing) break;
        this.probeSamples = [];
        await delay(FRAME_PROBE_SAMPLE_MS);
        const samples = this.probeSamples ?? [];
        this.probeSamples = null;
        if (!this.isActive || !this.probing) break;
        results.push(summarizeFrameProbe(fps, samples));
      }
    } finally {
      this.probeSamples = null;
      this.probing = false;
      if (this.isActive) this.setInferenceFps(originalFps);
    }
    return results;
  }

  get pointStabilityMs(): number {
    return this.point.stabilityMs;
  }

  setPointStabilityMs(stabilityMs: number): void {
    this.point.setStabilityMs(
      boundedTiming('pointStabilityMs', stabilityMs, DEFAULT_POINT_STABILITY_MS),
    );
  }

  setGestureStabilityMs(source: VisionTriggerSource, stabilityMs: number): void {
    const bounded = boundedTiming('stabilityMs', stabilityMs, DEFAULT_GESTURE_COMMAND_CONFIG.stabilityMs);
    this.commandGate.setStabilityMs(source, bounded);
  }

  /**
   * Restricts one-shot trigger activation to a single neutral input source.
   * Calibration uses this so another recognized pose cannot lock the per-hand
   * command gate while a different source is under test. Null restores normal
   * arbitration across every supported trigger source.
   */
  focusTriggerSource(source: InputSourceId | null): void {
    if (source !== null && !TRIGGER_DEFINITIONS.some((definition) => definition.source === source)) {
      throw new Error(`${source} is not a trigger source provided by this vision channel.`);
    }
    this.triggerFocus = source;
    this.commandGate.reset();
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
      this.scheduleInference();
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
      /** One confused frame must not release pointing; the tracker requires a held pose. */
      const competingCommand = detectedCommand !== null &&
        detectedCommand.confidence >= DEFAULT_GESTURE_COMMAND_CONFIG.enterConfidence;
      const gatedCommand = this.triggerFocus === null
        ? detectedCommand
        : candidates.find((candidate) => candidate.source === this.triggerFocus) ?? null;
      this.commandGate.update(timestamp, gatedCommand);

      const direction: DirectionVector | null = this.point.update(
        result.landmarks[0] ?? [],
        timestamp,
        competingCommand,
      );
      if (direction) {
        this.pointing = true;
        this.context?.emit({ kind: 'direction', source: InputSourceId.HAND_POINT_DIRECTION, timestamp, direction });
      } else if (this.pointing) {
        this.emitPointingEnd(timestamp);
      }
      const fistConfidence = confidenceFor(candidates, InputSourceId.HAND_CLOSED_FIST);
      const focusedCommandConfidence = this.triggerFocus === null
        ? detectedCommand?.confidence ?? 0
        : confidenceFor(candidates, this.triggerFocus);
      const commandState = this.commandGate.state;
      const startupTiming = this.startupTiming;
      if (!startupTiming) throw new Error('Vision startup timing is unavailable.');
      const timing: VisionTimingDiagnostic = {
        ...startupTiming,
        inferenceDurationMs,
        sampleIntervalMs,
        effectiveFps: sampleIntervalMs === null || sampleIntervalMs <= 0
          ? null
          : 1_000 / sampleIntervalMs,
        requestedFps: this.inferenceFps,
      };
      this.probeSamples?.push(timing);
      this.options.onDiagnostic?.({
        fistState: this.commandGate.activeSource === InputSourceId.HAND_CLOSED_FIST
          ? commandState
          : 'READY',
        fistConfidence,
        direction,
        commandState,
        detectedCommand: detectedCommand?.source ?? null,
        confirmedCommand: commandState === 'LOCKED' ? this.commandGate.activeSource : null,
        commandConfidence: detectedCommand?.confidence ?? 0,
        focusedCommandConfidence,
        pointShapeObserved: this.point.isShapeObserved,
        timing,
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

  private scheduleInference(): void {
    this.timer = window.setInterval(() => this.infer(), 1_000 / this.inferenceFps);
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
    this.probing = false;
    this.probeSamples = null;
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
    this.triggerFocus = null;
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

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, durationMs));
}

function summarizeFrameProbe(
  requestedFps: VisionInferenceFps,
  samples: readonly VisionTimingDiagnostic[],
): VisionFrameRateProbeResult {
  const matching = samples.filter((sample) => sample.requestedFps === requestedFps);
  const effective = matching.flatMap((sample) =>
    sample.effectiveFps === null ? [] : [sample.effectiveFps],
  );
  return {
    requestedFps,
    effectiveFps: median(effective) ?? 0,
    medianInferenceDurationMs: median(matching.map((sample) => sample.inferenceDurationMs)) ?? 0,
    sampleCount: matching.length,
  };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? null;
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
    stabilityMsBySource: readStabilityBySource(timing?.stabilityMsBySource),
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

function readStabilityBySource(
  values: Readonly<Partial<Record<VisionTriggerSource, number>>> | undefined,
): Readonly<Partial<Record<VisionTriggerSource, number>>> {
  if (!values) return {};
  const result: Partial<Record<VisionTriggerSource, number>> = {};
  TRIGGER_DEFINITIONS.forEach(({ source }) => {
    const value = values[source];
    if (value !== undefined) {
      result[source] = boundedTiming(
        `stabilityMsBySource.${source}`,
        value,
        DEFAULT_GESTURE_COMMAND_CONFIG.stabilityMs,
      );
    }
  });
  return result;
}

function readInferenceFps(value: number): VisionInferenceFps {
  const match = VISION_INFERENCE_FPS_OPTIONS.find((fps) => fps === value);
  if (match === undefined) {
    throw new RangeError(`inferenceFps must be one of ${VISION_INFERENCE_FPS_OPTIONS.join(', ')}.`);
  }
  return match;
}

function boundedTiming(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < GESTURE_TIMING_MIN_MS || value > GESTURE_TIMING_MAX_MS) {
    throw new RangeError(`${name} must be between ${GESTURE_TIMING_MIN_MS} and ${GESTURE_TIMING_MAX_MS} ms.`);
  }
  return value;
}
