import {
  AdaptiveInput,
  BindingSettingsController,
  CalibrationProfileStore,
  InputSourceId,
  VisionInputChannel,
  channelOf,
  InputChannelId,
  type BindingActionView,
  type BindingChangePreview,
  type BindingSourceView,
  type CalibrationTask,
  type DirectionInputSignal,
  type InputSignal,
  type InputSourceDefinition,
  type TriggerInputSignal,
  type VisionDiagnostic,
  type VisionStatus,
} from '../../../packages/adaptive-input/src/index.ts';
import { SWARMFALL_ACTION_CATALOG } from './actionCatalog.ts';
import type { ActionPayloadMap, GameAction, GameActionBus } from './actionBus.ts';

const AVAILABLE_INPUTS = [
  { id: InputSourceId.TOUCH_BUTTON, label: 'Touch button', tasks: ['TRIGGER'], scope: 'TARGETED', requiresCamera: false },
  { id: InputSourceId.TOUCH_DIRECTION, label: 'Touch direction', tasks: ['DIRECTION'], scope: 'TARGETED', requiresCamera: false },
  { id: InputSourceId.HAND_CLOSED_FIST, label: 'Closed fist', tasks: ['TRIGGER'], scope: 'GLOBAL', requiresCamera: true },
  { id: InputSourceId.HAND_OPEN_PALM, label: 'Open palm', tasks: ['TRIGGER'], scope: 'GLOBAL', requiresCamera: true },
  { id: InputSourceId.HAND_THUMB_UP, label: 'Thumbs up', tasks: ['TRIGGER'], scope: 'GLOBAL', requiresCamera: true },
  { id: InputSourceId.HAND_POINT_DIRECTION, label: 'Point direction', tasks: ['DIRECTION'], scope: 'GLOBAL', requiresCamera: true },
] as const satisfies readonly InputSourceDefinition[];

const TRIGGER_ACTIONS = ['GATHER_UNITS', 'SPREAD_UNITS', 'TOGGLE_SQUAD'] as const;
const BINDING_STORAGE_KEY = 'teamfreegpt.swarmfall.bindings.v1';
const GESTURE_SCHEME: Partial<Record<GameAction, InputSourceId>> = {
  GATHER_UNITS: InputSourceId.HAND_CLOSED_FIST,
  SPREAD_UNITS: InputSourceId.HAND_OPEN_PALM,
  TOGGLE_SQUAD: InputSourceId.HAND_THUMB_UP,
  DIRECT_UNITS: InputSourceId.HAND_POINT_DIRECTION,
};

export interface AdaptiveAttemptFeedback {
  actionLabel: string;
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
  controlScheme: 'TOUCH' | 'GESTURE' | 'CUSTOM';
}

export interface CalibrationRequest {
  action: GameAction;
  task: CalibrationTask;
  currentSource: InputSourceId;
  alternativeSource: InputSourceId;
}

export interface SwarmfallAdaptiveCallbacks {
  onAttempt(feedback: AdaptiveAttemptFeedback): void;
  onNotice(message: string, isError: boolean): void;
  onSettingsChanged(view: SwarmfallBindingSettingsView): void;
  onSettingsVisibilityChanged(open: boolean): void;
  onCalibrationRequested(request: CalibrationRequest): void;
  onVisionStatus(status: VisionStatus, detail?: string): void;
  onTrainingChanged(active: boolean): void;
  onTrainingDiagnostic(diagnostic: VisionDiagnostic): void;
  onTrainingSignal(signal: InputSignal): void;
}

function sourceLabel(source: InputSourceId): string {
  return AVAILABLE_INPUTS.find((definition) => definition.id === source)?.label ?? source;
}

export class SwarmfallAdaptiveInput {
  private readonly adaptive = new AdaptiveInput<ActionPayloadMap>();
  private readonly settings: BindingSettingsController<ActionPayloadMap>;
  private readonly profileStore = new CalibrationProfileStore(window.localStorage);
  private readonly vision: VisionInputChannel;
  private visionStatus: VisionStatus = 'IDLE';
  private selectedAction: GameAction = SWARMFALL_ACTION_CATALOG[0].id;
  private selectedSource: InputSourceId | null = null;
  private stage: SwarmfallBindingSettingsView['stage'] = 'CHOOSE';
  private training = false;

  constructor(gameBus: GameActionBus, video: HTMLVideoElement, private readonly callbacks: SwarmfallAdaptiveCallbacks) {
    this.adaptive.registerActions(SWARMFALL_ACTION_CATALOG);
    this.settings = new BindingSettingsController(this.adaptive, SWARMFALL_ACTION_CATALOG, AVAILABLE_INPUTS);
    this.adaptive.on('GATHER_UNITS', (payload) => gameBus.emit('GATHER_UNITS', payload));
    this.adaptive.on('SPREAD_UNITS', (payload) => gameBus.emit('SPREAD_UNITS', payload));
    this.adaptive.on('TOGGLE_SQUAD', (payload) => gameBus.emit('TOGGLE_SQUAD', payload));
    this.adaptive.on('DIRECT_UNITS', (payload) => gameBus.emit('DIRECT_UNITS', payload));
    this.adaptive.bindings.onChange(() => this.refreshSettings());

    this.vision = new VisionInputChannel(video, {
      onStatus: (status, detail) => {
        this.visionStatus = status;
        this.callbacks.onVisionStatus(status, detail);
        if (status === 'ERROR') {
          if (this.training) {
            this.training = false;
            this.callbacks.onTrainingChanged(false);
          }
          this.restoreTouchForVisionBindings();
        }
      },
      onDiagnostic: (diagnostic) => {
        if (this.training) this.callbacks.onTrainingDiagnostic(diagnostic);
      },
    });
    this.refreshSettings();
    void this.restoreSavedBindings();
  }

  attemptTouchAction(action: typeof TRIGGER_ACTIONS[number]): void {
    this.emitTriggerFor(action, { kind: 'trigger', source: InputSourceId.TOUCH_BUTTON, timestamp: performance.now(), phase: 'gameplay' });
  }

  attemptTouchDirection(direction: { x: number; y: number } | null): void {
    const timestamp = performance.now();
    const signal: InputSignal = direction
      ? { kind: 'direction', source: InputSourceId.TOUCH_DIRECTION, timestamp, direction, phase: 'gameplay' }
      : { kind: 'direction-end', source: InputSourceId.TOUCH_DIRECTION, timestamp, phase: 'gameplay' };
    this.emitDirection(signal);
  }

  openSettings(): void { this.selectedSource = null; this.stage = 'CHOOSE'; this.refreshSettings(); this.callbacks.onSettingsVisibilityChanged(true); }
  closeSettings(): void { this.stopTraining(); this.callbacks.onSettingsVisibilityChanged(false); }

  async toggleControlScheme(): Promise<void> {
    if (this.controlScheme() === 'GESTURE') {
      this.applyTouchScheme();
      this.callbacks.onNotice('Touch control scheme restored.', false);
      return;
    }
    try {
      await this.startVision(false);
      this.applyGestureScheme();
      this.callbacks.onNotice('Gesture control scheme enabled.', false);
    } catch {
      this.callbacks.onNotice('Gesture controls could not start. Touch controls remain active.', true);
    }
  }

  openPendingSettings(actionId: string, sourceId: string): void {
    const action = this.settings.actions().find((candidate) => candidate.id === actionId);
    if (!action) return;
    const source = this.settings.sourcesFor(action.id).find((candidate) => candidate.id === sourceId && !candidate.isCurrent);
    if (!source) return;
    this.selectedAction = action.id;
    this.selectedSource = source.id;
    this.stage = 'PREPARE';
    this.refreshSettings();
    this.callbacks.onSettingsVisibilityChanged(true);
  }

  selectSettingsAction(actionId: string): void {
    const action = this.settings.actions().find((candidate) => candidate.id === actionId);
    if (!action) return;
    this.selectedAction = action.id; this.selectedSource = null; this.stage = 'CHOOSE'; this.refreshSettings();
  }

  selectSettingsSource(sourceId: string): void {
    const source = this.settings.sourcesFor(this.selectedAction).find((candidate) => candidate.id === sourceId);
    if (!source || source.isCurrent) return;
    this.selectedSource = source.id; this.stage = 'PREPARE'; this.refreshSettings();
  }

  reviewSelectedBinding(): void { this.stage = 'REVIEW'; this.refreshSettings(); }
  startSelectedCalibration(): void {
    const preview = this.currentPreview();
    const action = SWARMFALL_ACTION_CATALOG.find((candidate) => candidate.id === this.selectedAction);
    if (!preview || !action) return;
    this.callbacks.onCalibrationRequested({
      action: this.selectedAction,
      task: action.requirements.task,
      currentSource: preview.from,
      alternativeSource: preview.to,
    });
  }
  keepCurrentBinding(): void { this.selectedSource = null; this.stage = 'CHOOSE'; this.refreshSettings(); this.closeSettings(); }

  async confirmSelectedBinding(): Promise<void> {
    const preview = this.currentPreview();
    if (!preview) return;
    if (preview.requiresCamera && this.visionStatus !== 'READY') {
      try { await this.startVision(false); } catch { return; }
    }
    this.settings.confirm(preview, true, true);
    this.saveBindings();
    if (!preview.readyToApply) this.callbacks.onNotice(`${preview.toLabel} enabled without calibration.`, false);
    else this.callbacks.onNotice(`${preview.toLabel} now controls ${preview.actionLabel}.`, false);
    this.selectedSource = null; this.stage = 'CHOOSE'; this.refreshSettings();
  }

  resetSelectedBinding(): void {
    this.settings.reset(this.selectedAction);
    this.saveBindings();
    this.selectedSource = null; this.stage = 'CHOOSE';
    if (!this.hasVisionBinding()) this.vision.stop();
    this.callbacks.onNotice('Original touch control restored.', false); this.refreshSettings();
  }

  async startTraining(): Promise<void> {
    this.training = true;
    this.callbacks.onTrainingChanged(true);
    try { await this.startVision(true); } catch { this.stopTraining(); }
  }

  stopTraining(): void {
    if (!this.training) return;
    this.training = false;
    this.callbacks.onTrainingChanged(false);
    if (this.hasVisionBinding()) void this.startVision(false);
    else this.vision.stop();
  }

  private async startVision(training: boolean): Promise<void> {
    this.training = training;
    await this.vision.start({ emit: (signal) => {
      if (this.training) this.callbacks.onTrainingSignal(signal);
      else this.handleVisionSignal(signal);
    } });
  }

  private refreshSettings(): void {
    this.callbacks.onSettingsChanged({ actions: this.settings.actions(), selectedAction: this.selectedAction,
      sources: this.settings.sourcesFor(this.selectedAction), selectedSource: this.selectedSource,
      preview: this.currentPreview(), stage: this.stage, controlScheme: this.controlScheme() });
  }

  private currentPreview(): BindingChangePreview<GameAction> | null {
    return this.selectedSource === null ? null : this.settings.preview(this.selectedAction, this.selectedSource, this.profileStore.load());
  }

  private hasVisionBinding(): boolean {
    return this.settings.actions().some((action) => channelOf(action.currentSource) === InputChannelId.HAND_VISION);
  }

  private controlScheme(): SwarmfallBindingSettingsView['controlScheme'] {
    const actions = this.settings.actions();
    const gesture = actions.every((action) => GESTURE_SCHEME[action.id] === action.currentSource);
    if (gesture) return 'GESTURE';
    const touch = actions.every((action) => action.currentSource === action.defaultSource);
    return touch ? 'TOUCH' : 'CUSTOM';
  }

  private applyGestureScheme(): void {
    this.settings.actions().forEach((action) => {
      const source = GESTURE_SCHEME[action.id];
      if (source && action.currentSource !== source) this.adaptive.rebind(action.id, source);
    });
    this.saveBindings();
    this.refreshSettings();
  }

  private applyTouchScheme(): void {
    this.settings.actions().forEach((action) => this.settings.reset(action.id));
    this.saveBindings();
    this.vision.stop();
    this.refreshSettings();
  }

  private saveBindings(): void {
    const bindings = Object.fromEntries(
      this.settings.actions().map((action) => [action.id, action.currentSource]),
    );
    window.localStorage.setItem(BINDING_STORAGE_KEY, JSON.stringify(bindings));
  }

  private async restoreSavedBindings(): Promise<void> {
    const serialized = window.localStorage.getItem(BINDING_STORAGE_KEY);
    if (!serialized) return;
    let value: unknown;
    try { value = JSON.parse(serialized); } catch { return; }
    if (!isRecord(value)) return;
    const saved = this.settings.actions().flatMap((action) => {
      const source = value[action.id];
      const compatible = isInputSourceId(source) && this.settings
        .sourcesFor(action.id)
        .some((candidate) => candidate.id === source);
      return compatible ? [{ action: action.id, source }] : [];
    });
    if (saved.some(({ source }) => channelOf(source) === InputChannelId.HAND_VISION)) {
      try { await this.startVision(false); } catch { return; }
    }
    saved.forEach(({ action, source }) => {
      if (this.adaptive.bindings.get(action) !== source) this.adaptive.rebind(action, source);
    });
    this.refreshSettings();
  }

  private restoreTouchForVisionBindings(): void {
    let restored = false;
    this.settings.actions().forEach((action) => {
      if (channelOf(action.currentSource) !== InputChannelId.HAND_VISION) return;
      this.settings.reset(action.id); restored = true;
    });
    if (restored) this.callbacks.onNotice('Visual input stopped. Touch controls were restored.', true);
  }

  private handleVisionSignal(signal: InputSignal): void {
    if (signal.kind === 'trigger') TRIGGER_ACTIONS.forEach((action) => this.emitTriggerFor(action, signal));
    else this.emitDirection(signal);
  }

  private emitTriggerFor(action: typeof TRIGGER_ACTIONS[number], signal: TriggerInputSignal): void {
    const accepted = this.adaptive.emitFrom(action, {}, signal);
    if (!accepted && signal.source === InputSourceId.TOUCH_BUTTON) return;
    const descriptor = SWARMFALL_ACTION_CATALOG.find((item) => item.id === action);
    const binding = this.adaptive.bindings.get(action) ?? InputSourceId.TOUCH_BUTTON;
    this.callbacks.onAttempt({ actionLabel: descriptor?.label ?? action, sourceLabel: sourceLabel(signal.source), accepted,
      bindingLabel: sourceLabel(binding), ...(signal.confidence === undefined ? {} : { confidence: signal.confidence }) });
  }

  private emitDirection(signal: DirectionInputSignal | Extract<InputSignal, { kind: 'direction-end' }>): void {
    this.adaptive.emitFrom('DIRECT_UNITS', { direction: signal.kind === 'direction' ? signal.direction : null }, signal);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isInputSourceId(value: unknown): value is InputSourceId {
  return typeof value === 'string' && Object.values(InputSourceId).some((source) => source === value);
}
