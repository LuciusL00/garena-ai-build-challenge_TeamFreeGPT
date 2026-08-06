/** Game-independent state behind a host-rendered control-binding screen. */

import type {
  ActionDescriptor,
  ActionId,
  ActionKey,
  CalibrationTask,
} from './actions.ts';
import type { AdaptiveInput } from './bus.ts';
import type {
  CalibrationProfile,
  VisionInferenceFps,
  VisionTuningPreferences,
} from './profile.ts';
import { VISION_INFERENCE_FPS_OPTIONS } from './profile.ts';
import { ControlRecommender } from './recommendation/recommender.ts';
import type { Recommendation } from './recommendation/types.ts';
import type { InputSourceId } from './sources.ts';
import type { VisionFrameRateProbeResult } from './vision/visionInputChannel.ts';

export type InputSourceScope = 'TARGETED' | 'GLOBAL';

/** One neutral input that an integrating game has made available. */
export interface InputSourceDefinition {
  id: InputSourceId;
  label: string;
  tasks: readonly CalibrationTask[];
  /** Global sources need conflict checks because they do not identify a UI target. */
  scope: InputSourceScope;
  requiresCamera: boolean;
}

/** Host-supplied action metadata. No game behaviour is implemented here. */
export interface SettingsActionDefinition<
  M extends object,
  K extends ActionKey<M> = ActionKey<M>,
> extends ActionDescriptor<M, K> {
  label: string;
  description: string;
  /** Sources may be reused in different contexts, but not twice in one context. */
  context: string;
}

export interface BindingActionView<A extends ActionId = ActionId> {
  id: A;
  label: string;
  description: string;
  currentSource: InputSourceId;
  currentSourceLabel: string;
  defaultSource: InputSourceId;
  remappable: boolean;
}

export interface BindingSourceView {
  id: InputSourceId;
  label: string;
  requiresCamera: boolean;
  isCurrent: boolean;
}

export interface BindingConflict<A extends ActionId = ActionId> {
  action: A;
  label: string;
}

export interface BindingChangePreview<A extends ActionId = ActionId> {
  action: A;
  actionLabel: string;
  from: InputSourceId;
  fromLabel: string;
  to: InputSourceId;
  toLabel: string;
  requiresCamera: boolean;
  conflicts: readonly BindingConflict<A>[];
  recommendation: Recommendation<A>;
  readyToApply: boolean;
}

/** How a measured rate was chosen, so the host can say which it is showing. */
export type VisionDeviceOrigin = 'DEFAULT' | 'MANUAL' | 'MEASURED';

export interface VisionDeviceOptionView {
  fps: VisionInferenceFps;
  selected: boolean;
  /** Present once this rate has been measured on this device. */
  measured?: { effectiveFps: number; inferenceDurationMs: number };
}

export interface VisionDeviceSettingsView {
  options: readonly VisionDeviceOptionView[];
  selected: VisionInferenceFps;
  origin: VisionDeviceOrigin;
  /** A measurement needs a running camera; manual selection never does. */
  measurable: boolean;
  measuring: boolean;
  detail: string;
}

/** The part of a vision channel these settings drive, kept free of the model. */
export interface VisionDeviceTarget {
  readonly isActive: boolean;
  readonly requestedInferenceFps: VisionInferenceFps;
  setInferenceFps(fps: VisionInferenceFps): void;
  measureInferenceFps(): Promise<readonly VisionFrameRateProbeResult[]>;
}

export interface VisionTuningPersistence {
  load(): VisionTuningPreferences;
  save(preferences: VisionTuningPreferences): void;
}

/**
 * Camera processing rate as a device-wide setting. It is one rate for every
 * visual input, so it belongs beside the game's other options rather than
 * inside any single input's calibration. Games render this view; they never
 * reach past it to the camera.
 */
export class VisionDeviceSettings {
  private origin: VisionDeviceOrigin = 'DEFAULT';
  private measuring = false;
  private results: readonly VisionFrameRateProbeResult[] = [];
  private detail = 'One rate is used by every camera input on this device.';

  constructor(
    private readonly target: VisionDeviceTarget,
    private readonly store: VisionTuningPersistence,
  ) {}

  view(): VisionDeviceSettingsView {
    const selected = this.target.requestedInferenceFps;
    return {
      options: VISION_INFERENCE_FPS_OPTIONS.map((fps) => {
        const measured = this.results.find((result) => result.requestedFps === fps);
        return {
          fps,
          selected: fps === selected,
          ...(measured
            ? {
                measured: {
                  effectiveFps: measured.effectiveFps,
                  inferenceDurationMs: measured.medianInferenceDurationMs,
                },
              }
            : {}),
        };
      }),
      selected,
      origin: this.origin,
      measurable: this.target.isActive && !this.measuring,
      measuring: this.measuring,
      detail: this.detail,
    };
  }

  /** Direct player choice. Allowed with the camera off; it applies on next start. */
  select(fps: VisionInferenceFps): VisionDeviceSettingsView {
    if (this.measuring) return this.view();
    if (!VISION_INFERENCE_FPS_OPTIONS.includes(fps)) {
      throw new RangeError(`${fps} is not a supported camera processing rate.`);
    }
    this.apply(fps, 'MANUAL', `${fps} FPS selected for every camera input on this device.`);
    return this.view();
  }

  /** Measures each supported rate, then applies the fastest one sustained. */
  async measure(
    recommend: (results: readonly VisionFrameRateProbeResult[]) => VisionInferenceFps | null,
    onChange?: (view: VisionDeviceSettingsView) => void,
  ): Promise<VisionDeviceSettingsView> {
    if (this.measuring) return this.view();
    if (!this.target.isActive) {
      this.detail = 'Turn the camera on before measuring what this device sustains.';
      return this.view();
    }
    this.measuring = true;
    this.detail = 'Measuring 10, 12 and 15 FPS. Keep your hand in view and move it gently.';
    onChange?.(this.view());
    try {
      this.results = await this.target.measureInferenceFps();
      const recommended = recommend(this.results);
      if (recommended === null) {
        this.detail = 'No rate produced enough steady samples. Your current choice was kept.';
      } else {
        this.apply(
          recommended,
          'MEASURED',
          `${recommended} FPS measured as the fastest rate this device sustains.`,
        );
      }
    } catch (error: unknown) {
      this.detail = error instanceof Error
        ? error.message
        : 'The camera speed could not be measured.';
    } finally {
      this.measuring = false;
    }
    return this.view();
  }

  private apply(fps: VisionInferenceFps, origin: VisionDeviceOrigin, detail: string): void {
    this.target.setInferenceFps(fps);
    this.store.save({ ...this.store.load(), inferenceFps: fps });
    this.origin = origin;
    this.detail = detail;
  }
}

/**
 * Supplies settings data and enforces confirmation-time checks. Games may
 * render this state with web, native, Unity, or another UI toolkit.
 */
export class BindingSettingsController<M extends object> {
  private readonly actionsById = new Map<ActionKey<M>, SettingsActionDefinition<M>>();
  private readonly sourcesById = new Map<InputSourceId, InputSourceDefinition>();
  private readonly recommender = new ControlRecommender();

  constructor(
    private readonly adaptive: AdaptiveInput<M>,
    actions: readonly SettingsActionDefinition<M>[],
    sources: readonly InputSourceDefinition[],
  ) {
    const registered = new Set(adaptive.registeredActions());
    actions.forEach((action) => {
      if (!registered.has(action.id)) {
        throw new Error(`Settings action "${action.id}" is not registered.`);
      }
      if (this.actionsById.has(action.id)) {
        throw new Error(`Settings action "${action.id}" is duplicated.`);
      }
      this.actionsById.set(action.id, action);
    });
    sources.forEach((source) => {
      if (this.sourcesById.has(source.id)) {
        throw new Error(`Input source "${source.id}" is duplicated.`);
      }
      this.sourcesById.set(source.id, source);
    });
    actions.forEach((action) => {
      if (!this.sourcesById.has(action.defaultSource)) {
        throw new Error(`Default source "${action.defaultSource}" has no settings definition.`);
      }
    });
  }

  actions(): readonly BindingActionView<ActionKey<M>>[] {
    return [...this.actionsById.values()].map((action) => {
      const currentSource = this.currentSource(action.id);
      return {
        id: action.id,
        label: action.label,
        description: action.description,
        currentSource,
        currentSourceLabel: this.sourceLabel(currentSource),
        defaultSource: action.defaultSource,
        remappable: action.remappable,
      };
    });
  }

  sourcesFor(actionId: ActionKey<M>): readonly BindingSourceView[] {
    const action = this.action(actionId);
    const currentSource = this.currentSource(actionId);
    if (!action.remappable) return [];
    return [...this.sourcesById.values()]
      .filter((source) => source.tasks.includes(action.requirements.task))
      .map((source) => ({
        id: source.id,
        label: source.label,
        requiresCamera: source.requiresCamera,
        isCurrent: source.id === currentSource,
      }));
  }

  preview(
    actionId: ActionKey<M>,
    targetSource: InputSourceId,
    profile: CalibrationProfile,
  ): BindingChangePreview<ActionKey<M>> {
    const action = this.action(actionId);
    const source = this.source(targetSource);
    if (!action.remappable) throw new Error(`Action "${actionId}" cannot be remapped.`);
    if (!source.tasks.includes(action.requirements.task)) {
      throw new Error(`Input source "${targetSource}" is incompatible with action "${actionId}".`);
    }

    const currentSource = this.currentSource(actionId);
    const recommendation = this.recommender.recommend(
      {
        action: actionId,
        requirements: action.requirements,
        currentSource,
        alternativeSource: targetSource,
      },
      profile,
    );
    return {
      action: actionId,
      actionLabel: action.label,
      from: currentSource,
      fromLabel: this.sourceLabel(currentSource),
      to: targetSource,
      toLabel: source.label,
      requiresCamera: source.requiresCamera,
      conflicts: this.conflictsFor(action, source),
      recommendation,
      readyToApply: recommendation.verdict !== 'needs-calibration',
    };
  }

  /** Call only after the player explicitly accepts the prepared change. */
  confirm(
    preview: BindingChangePreview<ActionKey<M>>,
    replaceConflicts: boolean = false,
  ): void {
    this.applyConfirmedChange(preview, replaceConflicts, false);
  }

  /**
   * Explicit opt-out from testing. This applies no score or recommendation and
   * is valid only while the preview still reports missing calibration.
   */
  confirmWithoutCalibration(
    preview: BindingChangePreview<ActionKey<M>>,
    replaceConflicts: boolean = false,
  ): void {
    if (preview.readyToApply) {
      throw new Error('Use confirm() when calibration evidence is available.');
    }
    this.applyConfirmedChange(preview, replaceConflicts, true);
  }

  private applyConfirmedChange(
    preview: BindingChangePreview<ActionKey<M>>,
    replaceConflicts: boolean,
    allowUncalibrated: boolean,
  ): void {
    if (!preview.readyToApply && !allowUncalibrated) {
      throw new Error('Calibration is required before applying this binding.');
    }
    if (this.currentSource(preview.action) !== preview.from) {
      throw new Error('The binding changed after this recommendation was prepared.');
    }
    const action = this.action(preview.action);
    const source = this.source(preview.to);
    const conflicts = this.conflictsFor(action, source);
    if (conflicts.length > 0 && !replaceConflicts) {
      throw new Error(`Input source "${preview.to}" is already used in this context.`);
    }
    conflicts.forEach((conflict) => this.reset(conflict.action));
    this.adaptive.rebind(preview.action, preview.to);
  }

  reset(actionId: ActionKey<M>): void {
    const action = this.action(actionId);
    if (this.currentSource(actionId) === action.defaultSource) return;
    this.adaptive.rebind(actionId, action.defaultSource);
  }

  private conflictsFor(
    action: SettingsActionDefinition<M>,
    source: InputSourceDefinition,
  ): readonly BindingConflict<ActionKey<M>>[] {
    if (source.scope !== 'GLOBAL') return [];
    return this.adaptive.bindings.entries().flatMap(([otherActionId, boundSource]) => {
      if (otherActionId === action.id || boundSource !== source.id) return [];
      const otherAction = this.actionsById.get(otherActionId);
      if (!otherAction || otherAction.context !== action.context) return [];
      return [{ action: otherActionId, label: otherAction.label }];
    });
  }

  private action(actionId: ActionKey<M>): SettingsActionDefinition<M> {
    const action = this.actionsById.get(actionId);
    if (!action) throw new Error(`Unknown settings action "${actionId}".`);
    return action;
  }

  private source(sourceId: InputSourceId): InputSourceDefinition {
    const source = this.sourcesById.get(sourceId);
    if (!source) throw new Error(`Unknown input source "${sourceId}".`);
    return source;
  }

  private currentSource(actionId: ActionKey<M>): InputSourceId {
    const source = this.adaptive.bindings.get(actionId);
    if (!source) throw new Error(`Action "${actionId}" has no binding.`);
    return source;
  }

  private sourceLabel(sourceId: InputSourceId): string {
    return this.sourcesById.get(sourceId)?.label ?? sourceId;
  }
}
