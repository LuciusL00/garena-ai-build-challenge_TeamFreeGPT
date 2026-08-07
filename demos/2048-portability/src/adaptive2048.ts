import {
  AdaptiveInput,
  InputSourceId,
  VisionInputChannel,
  VisionTuningStore,
  type EmissionRecord,
  type InputSignal,
  type VisionStatus,
} from '../../../packages/adaptive-input/src/index.ts';

export type MoveDirection = 'up' | 'right' | 'down' | 'left';
export type Portability2048Source =
  | InputSourceId.TOUCH_DIRECTION
  | InputSourceId.HAND_POINT_DIRECTION;

interface Portability2048Actions {
  MOVE_TILES: { direction: MoveDirection };
}

export interface Portability2048Attempt {
  readonly source: Portability2048Source;
  readonly direction: MoveDirection;
  readonly accepted: boolean;
}

export interface Portability2048Callbacks {
  onMove(direction: MoveDirection): void;
  onBindingChanged(source: Portability2048Source): void;
  onVisionStatus(status: VisionStatus, detail?: string): void;
  onDetectedDirection(direction: MoveDirection | null): void;
  onAttempt(attempt: Portability2048Attempt): void;
  onTelemetry(record: EmissionRecord<'MOVE_TILES'>): void;
}

const GESTURE_DIRECTION_HOLD_MS = 160;

const DIRECTION_VECTOR: Record<MoveDirection, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/**
 * The complete game-specific adapter for the 2048 portability host.
 * The reusable package never sees a tile, board or 2048 direction index.
 */
export class Adaptive2048Input {
  private readonly adaptive = new AdaptiveInput<Portability2048Actions>();
  private readonly vision: VisionInputChannel;
  private readonly stopMove: () => void;
  private readonly stopTelemetry: () => void;
  private currentSource: Portability2048Source = InputSourceId.TOUCH_DIRECTION;
  private gestureArmed = true;
  private pendingGesture: { direction: MoveDirection; since: number } | null = null;

  constructor(
    video: HTMLVideoElement,
    private readonly callbacks: Portability2048Callbacks,
  ) {
    this.adaptive.registerActions([
      {
        id: 'MOVE_TILES',
        requirements: { task: 'DIRECTION', spatial: false, latencyCritical: false },
        defaultSource: InputSourceId.TOUCH_DIRECTION,
        remappable: true,
      },
    ]);
    this.stopMove = this.adaptive.on('MOVE_TILES', ({ direction }) => {
      this.callbacks.onMove(direction);
    });
    this.stopTelemetry = this.adaptive.telemetry.subscribe((record) => {
      this.callbacks.onTelemetry(record);
    });

    const tuning = new VisionTuningStore(window.localStorage).load();
    this.vision = new VisionInputChannel(video, {
      inferenceFps: tuning.inferenceFps,
      pointStabilityMs: tuning.pointStabilityMs,
      gestureTiming: { stabilityMsBySource: tuning.gestureStabilityMs },
      onStatus: (status, detail) => {
        this.callbacks.onVisionStatus(status, detail);
        if (status === 'ERROR' && this.currentSource === InputSourceId.HAND_POINT_DIRECTION) {
          this.restoreTouch();
        }
      },
    });
  }

  get binding(): Portability2048Source {
    return this.currentSource;
  }

  attemptTouch(direction: MoveDirection): void {
    const vector = DIRECTION_VECTOR[direction];
    this.emit(direction, {
      kind: 'direction',
      source: InputSourceId.TOUCH_DIRECTION,
      timestamp: performance.now(),
      direction: vector,
      phase: 'gameplay',
    });
  }

  async selectSource(source: Portability2048Source): Promise<boolean> {
    if (source === this.currentSource) return true;
    this.resetGesture();

    if (source === InputSourceId.HAND_POINT_DIRECTION) {
      try {
        await this.vision.start({ emit: (signal) => this.handleVisionSignal(signal) });
      } catch {
        this.restoreTouch();
        return false;
      }
    }

    this.adaptive.rebind('MOVE_TILES', source);
    this.currentSource = source;
    this.callbacks.onBindingChanged(source);
    if (source === InputSourceId.TOUCH_DIRECTION) this.vision.stop();
    return true;
  }

  dispose(): void {
    this.stopMove();
    this.stopTelemetry();
    this.vision.stop();
  }

  private handleVisionSignal(signal: InputSignal): void {
    if (signal.source !== InputSourceId.HAND_POINT_DIRECTION) return;
    if (signal.kind === 'direction-end') {
      this.resetGesture();
      this.callbacks.onDetectedDirection(null);
      return;
    }
    if (signal.kind !== 'direction') return;

    const direction = quantizeDirection(signal.direction);
    this.callbacks.onDetectedDirection(direction);
    if (!this.gestureArmed) return;

    if (this.pendingGesture?.direction !== direction) {
      this.pendingGesture = { direction, since: signal.timestamp };
      return;
    }
    if (signal.timestamp - this.pendingGesture.since < GESTURE_DIRECTION_HOLD_MS) return;

    this.emit(direction, signal);
    this.gestureArmed = false;
    this.pendingGesture = null;
  }

  private emit(direction: MoveDirection, signal: Extract<InputSignal, { kind: 'direction' }>): void {
    const accepted = this.adaptive.emitFrom('MOVE_TILES', { direction }, signal);
    this.callbacks.onAttempt({ source: signal.source as Portability2048Source, direction, accepted });
  }

  private restoreTouch(): void {
    if (this.currentSource !== InputSourceId.TOUCH_DIRECTION) {
      this.adaptive.rebind('MOVE_TILES', InputSourceId.TOUCH_DIRECTION);
      this.currentSource = InputSourceId.TOUCH_DIRECTION;
      this.callbacks.onBindingChanged(this.currentSource);
    }
    this.resetGesture();
  }

  private resetGesture(): void {
    this.gestureArmed = true;
    this.pendingGesture = null;
  }
}

export function quantizeDirection(direction: { x: number; y: number }): MoveDirection {
  if (Math.abs(direction.x) > Math.abs(direction.y)) return direction.x >= 0 ? 'right' : 'left';
  return direction.y >= 0 ? 'down' : 'up';
}
