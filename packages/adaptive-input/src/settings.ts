/** Game-independent state behind a host-rendered control-binding screen. */

import type {
  ActionDescriptor,
  ActionId,
  ActionKey,
  CalibrationTask,
} from './actions.ts';
import type { AdaptiveInput } from './bus.ts';
import type { CalibrationProfile } from './profile.ts';
import { ControlRecommender } from './recommendation/recommender.ts';
import type { Recommendation } from './recommendation/types.ts';
import type { InputSourceId } from './sources.ts';

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
    if (!preview.readyToApply) throw new Error('Calibration is required before applying this binding.');
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
