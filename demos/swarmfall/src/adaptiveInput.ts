import { VisionController, type VisionStatus } from '../../../app/calibration/vision-controller.ts';
import {
  AdaptiveInput,
  InputSourceId,
  type TriggerInputSignal,
} from '../../../packages/adaptive-input/src/index.ts';
import type { ActionPayloadMap, GameActionBus } from './actionBus.ts';

const TOGGLE_SQUAD = 'TOGGLE_SQUAD' as const;

export interface AdaptiveAttemptFeedback {
  source: InputSourceId.TOUCH_BUTTON | InputSourceId.HAND_CLOSED_FIST;
  sourceLabel: string;
  bindingLabel: string;
  accepted: boolean;
  confidence?: number;
}

export interface SwarmfallAdaptiveCallbacks {
  onAttempt(feedback: AdaptiveAttemptFeedback): void;
  onBindingChanged(source: InputSourceId, label: string): void;
  onBindingUnavailable(message: string): void;
  onVisionStatus(status: VisionStatus, detail?: string): void;
}

function sourceLabel(source: InputSourceId): string {
  if (source === InputSourceId.HAND_CLOSED_FIST) return 'Closed fist';
  return 'Touch button';
}

export class SwarmfallAdaptiveInput {
  private readonly adaptive = new AdaptiveInput<ActionPayloadMap>();
  private readonly vision: VisionController;
  private visionStatus: VisionStatus = 'IDLE';

  constructor(
    gameBus: GameActionBus,
    video: HTMLVideoElement,
    private readonly callbacks: SwarmfallAdaptiveCallbacks,
  ) {
    this.adaptive.registerActions([
      {
        id: TOGGLE_SQUAD,
        requirements: { task: 'TRIGGER', spatial: false, latencyCritical: false },
        defaultSource: InputSourceId.TOUCH_BUTTON,
        remappable: true,
      },
    ]);

    this.adaptive.on(TOGGLE_SQUAD, (payload) => gameBus.emit(TOGGLE_SQUAD, payload));
    this.adaptive.bindings.onChange((_action, source) => {
      this.callbacks.onBindingChanged(source, sourceLabel(source));
    });

    this.vision = new VisionController(video, {
      onStatus: (status, detail) => {
        this.visionStatus = status;
        this.callbacks.onVisionStatus(status, detail);
        if (
          (status === 'DENIED' || status === 'UNAVAILABLE' || status === 'ERROR') &&
          this.currentSource() === InputSourceId.HAND_CLOSED_FIST
        ) {
          this.bindToTouch();
        }
      },
      onFistActivation: (timestamp, confidence) => {
        this.emitTrigger(InputSourceId.HAND_CLOSED_FIST, timestamp, confidence);
      },
      onFistState: () => undefined,
    });

    const initialSource = this.currentSource();
    this.callbacks.onBindingChanged(initialSource, sourceLabel(initialSource));
  }

  attemptTouchToggle(): void {
    this.emitTrigger(InputSourceId.TOUCH_BUTTON, performance.now());
  }

  async enableVisualInput(): Promise<void> {
    await this.vision.start();
  }

  stopVisualInput(): void {
    this.vision.stop();
    if (this.currentSource() === InputSourceId.HAND_CLOSED_FIST) this.bindToTouch();
  }

  useTouch(): void {
    this.bindToTouch();
  }

  useClosedFist(): void {
    if (this.visionStatus !== 'READY') {
      this.callbacks.onBindingUnavailable('Enable visual input and wait for Camera ready first.');
      return;
    }
    this.adaptive.rebind(TOGGLE_SQUAD, InputSourceId.HAND_CLOSED_FIST);
  }

  private bindToTouch(): void {
    this.adaptive.rebind(TOGGLE_SQUAD, InputSourceId.TOUCH_BUTTON);
  }

  private currentSource(): InputSourceId {
    return this.adaptive.bindings.get(TOGGLE_SQUAD) ?? InputSourceId.TOUCH_BUTTON;
  }

  private emitTrigger(
    source: InputSourceId.TOUCH_BUTTON | InputSourceId.HAND_CLOSED_FIST,
    timestamp: number,
    confidence?: number,
  ): void {
    const signal: TriggerInputSignal = {
      kind: 'trigger',
      source,
      timestamp,
      phase: 'gameplay',
      ...(confidence === undefined ? {} : { confidence }),
    };
    const accepted = this.adaptive.emitFrom(TOGGLE_SQUAD, {}, signal);
    const binding = this.currentSource();
    this.callbacks.onAttempt({
      source,
      sourceLabel: sourceLabel(source),
      bindingLabel: sourceLabel(binding),
      accepted,
      ...(confidence === undefined ? {} : { confidence }),
    });
  }
}
