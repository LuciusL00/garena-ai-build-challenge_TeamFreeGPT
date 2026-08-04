import { VisionController, type VisionStatus } from '../../../app/calibration/vision-controller.ts';
import {
  AdaptiveInput,
  BindingSettingsController,
  CalibrationProfileStore,
  InputSourceId,
  type BindingActionView,
  type BindingChangePreview,
  type BindingSourceView,
  type InputSourceDefinition,
  type TriggerInputSignal,
} from '../../../packages/adaptive-input/src/index.ts';
import { SWARMFALL_ACTION_CATALOG } from './actionCatalog.ts';
import type { ActionPayloadMap, GameAction, GameActionBus } from './actionBus.ts';

const AVAILABLE_INPUTS = [
  {
    id: InputSourceId.TOUCH_BUTTON,
    label: 'Touch button',
    tasks: ['TRIGGER'],
    scope: 'TARGETED',
    requiresCamera: false,
  },
  {
    id: InputSourceId.HAND_CLOSED_FIST,
    label: 'Closed fist',
    tasks: ['TRIGGER'],
    scope: 'GLOBAL',
    requiresCamera: true,
  },
] as const satisfies readonly InputSourceDefinition[];

export interface AdaptiveAttemptFeedback {
  sourceLabel: string;
  accepted: boolean;
  bindingLabel: string;
  confidence?: number;
}

export interface SwarmfallBindingSettingsView {
  actions: readonly BindingActionView<GameAction>[];
  selectedAction: GameAction;
  sources: readonly BindingSourceView[];
  selectedSource: InputSourceId | null;
  preview: BindingChangePreview<GameAction> | null;
  stage: 'CHOOSE' | 'PREPARE' | 'REVIEW';
}

export interface CalibrationRequest {
  action: GameAction;
  source: InputSourceId;
}

export interface SwarmfallAdaptiveCallbacks {
  onAttempt(feedback: AdaptiveAttemptFeedback): void;
  onNotice(message: string, isError: boolean): void;
  onSettingsChanged(view: SwarmfallBindingSettingsView): void;
  onSettingsVisibilityChanged(open: boolean): void;
  onCalibrationRequested(request: CalibrationRequest): void;
  onVisionStatus(status: VisionStatus, detail?: string): void;
}

function sourceLabel(source: InputSourceId): string {
  return AVAILABLE_INPUTS.find((definition) => definition.id === source)?.label ?? source;
}

export class SwarmfallAdaptiveInput {
  private readonly adaptive = new AdaptiveInput<ActionPayloadMap>();
  private readonly settings: BindingSettingsController<ActionPayloadMap>;
  private readonly profileStore = new CalibrationProfileStore(window.localStorage);
  private readonly vision: VisionController;
  private visionStatus: VisionStatus = 'IDLE';
  private selectedAction: GameAction = SWARMFALL_ACTION_CATALOG[0].id;
  private selectedSource: InputSourceId | null = null;
  private stage: SwarmfallBindingSettingsView['stage'] = 'CHOOSE';

  constructor(
    gameBus: GameActionBus,
    video: HTMLVideoElement,
    private readonly callbacks: SwarmfallAdaptiveCallbacks,
  ) {
    this.adaptive.registerActions(SWARMFALL_ACTION_CATALOG);
    this.settings = new BindingSettingsController(
      this.adaptive,
      SWARMFALL_ACTION_CATALOG,
      AVAILABLE_INPUTS,
    );

    this.adaptive.on('TOGGLE_SQUAD', (payload) => gameBus.emit('TOGGLE_SQUAD', payload));
    this.adaptive.bindings.onChange(() => this.refreshSettings());

    this.vision = new VisionController(video, {
      onStatus: (status, detail) => {
        this.visionStatus = status;
        this.callbacks.onVisionStatus(status, detail);
        if (
          status === 'DENIED' ||
          status === 'UNAVAILABLE' ||
          status === 'ERROR'
        ) {
          const restored = this.restoreTouchForVisionBindings();
          if (restored) {
            this.callbacks.onNotice('Visual input stopped. Touch control was restored.', true);
          }
        }
      },
      onFistActivation: (timestamp, confidence) => {
        this.emitTrigger(InputSourceId.HAND_CLOSED_FIST, timestamp, confidence);
      },
      onFistState: () => undefined,
    });

    this.refreshSettings();
  }

  attemptTouchToggle(): void {
    this.emitTrigger(InputSourceId.TOUCH_BUTTON, performance.now());
  }

  openSettings(): void {
    this.selectedSource = null;
    this.stage = 'CHOOSE';
    this.refreshSettings();
    this.callbacks.onSettingsVisibilityChanged(true);
  }

  openPendingSettings(actionId: string, sourceId: string): void {
    const action = this.settings.actions().find((candidate) => candidate.id === actionId);
    if (!action) return;
    const source = this.settings
      .sourcesFor(action.id)
      .find((candidate) => candidate.id === sourceId && !candidate.isCurrent);
    if (!source) return;
    this.selectedAction = action.id;
    this.selectedSource = source.id;
    this.stage = this.currentPreview()?.readyToApply ? 'REVIEW' : 'PREPARE';
    this.refreshSettings();
    this.callbacks.onSettingsVisibilityChanged(true);
  }

  closeSettings(): void {
    this.callbacks.onSettingsVisibilityChanged(false);
  }

  selectSettingsAction(actionId: string): void {
    const action = this.settings.actions().find((candidate) => candidate.id === actionId);
    if (!action) return;
    this.selectedAction = action.id;
    this.selectedSource = null;
    this.stage = 'CHOOSE';
    this.refreshSettings();
  }

  selectSettingsSource(sourceId: string): void {
    const source = this.settings
      .sourcesFor(this.selectedAction)
      .find((candidate) => candidate.id === sourceId);
    if (!source || source.isCurrent) return;
    this.selectedSource = source.id;
    this.stage = 'PREPARE';
    this.refreshSettings();
  }

  reviewSelectedBinding(): void {
    const preview = this.currentPreview();
    if (!preview?.readyToApply) {
      this.callbacks.onNotice('Complete the input test before reviewing this change.', true);
      return;
    }
    this.stage = 'REVIEW';
    this.refreshSettings();
  }

  startSelectedCalibration(): void {
    if (this.selectedSource === null) return;
    this.callbacks.onCalibrationRequested({
      action: this.selectedAction,
      source: this.selectedSource,
    });
  }

  keepCurrentBinding(): void {
    this.selectedSource = null;
    this.stage = 'CHOOSE';
    this.callbacks.onNotice('Current input kept. No binding was changed.', false);
    this.refreshSettings();
    this.closeSettings();
  }

  async confirmSelectedBinding(): Promise<void> {
    const preview = this.currentPreview();
    if (this.stage !== 'REVIEW' || !preview?.readyToApply) {
      this.callbacks.onNotice('Complete the input test before changing this control.', true);
      return;
    }

    if (preview.requiresCamera && !this.isVisionReady()) {
      await this.vision.start();
      if (!this.isVisionReady()) return;
    }

    this.settings.confirm(preview, true);
    if (!preview.requiresCamera) this.vision.stop();
    this.selectedSource = null;
    this.stage = 'CHOOSE';
    this.callbacks.onNotice(`${preview.toLabel} now controls ${preview.actionLabel}.`, false);
    this.refreshSettings();
  }

  resetSelectedBinding(): void {
    this.settings.reset(this.selectedAction);
    this.selectedSource = null;
    this.stage = 'CHOOSE';
    if (!this.hasVisionBinding()) this.vision.stop();
    this.callbacks.onNotice('Original touch control restored.', false);
    this.refreshSettings();
  }

  private refreshSettings(): void {
    const actions = this.settings.actions();
    const sources = this.settings.sourcesFor(this.selectedAction);
    this.callbacks.onSettingsChanged({
      actions,
      selectedAction: this.selectedAction,
      sources,
      selectedSource: this.selectedSource,
      preview: this.currentPreview(),
      stage: this.stage,
    });
  }

  private currentPreview(): BindingChangePreview<GameAction> | null {
    if (this.selectedSource === null) return null;
    return this.settings.preview(
      this.selectedAction,
      this.selectedSource,
      this.profileStore.load(),
    );
  }

  private hasVisionBinding(): boolean {
    return this.settings.actions().some(
      (action) => action.currentSource === InputSourceId.HAND_CLOSED_FIST,
    );
  }

  private isVisionReady(): boolean {
    return this.visionStatus === 'READY';
  }

  private restoreTouchForVisionBindings(): boolean {
    let restored = false;
    this.settings.actions().forEach((action) => {
      if (action.currentSource !== InputSourceId.HAND_CLOSED_FIST) return;
      this.settings.reset(action.id);
      restored = true;
    });
    return restored;
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
    const accepted = this.adaptive.emitFrom('TOGGLE_SQUAD', {}, signal);
    const binding = this.adaptive.bindings.get('TOGGLE_SQUAD') ?? InputSourceId.TOUCH_BUTTON;
    this.callbacks.onAttempt({
      sourceLabel: sourceLabel(source),
      accepted,
      bindingLabel: sourceLabel(binding),
      ...(confidence === undefined ? {} : { confidence }),
    });
  }
}
