/** The typed, game-independent action boundary. */

import type {
  ActionDescriptor,
  ActionKey,
  ActionRequirements,
} from './actions.ts';
import { DEFAULT_REQUIREMENTS } from './actions.ts';
import { BindingMap } from './bindings.ts';
import type { EmissionMeta, InputSignal, InputSourceId } from './sources.ts';
import { TelemetryRecorder } from './telemetry.ts';

type Listener<P> = (payload: P, meta: EmissionMeta) => void;
type StoredListener = (payload: unknown, meta: EmissionMeta) => void;

export class AdaptiveInput<M extends object> {
  readonly bindings = new BindingMap<ActionKey<M>>();
  readonly telemetry = new TelemetryRecorder<ActionKey<M>>();

  private readonly listeners = new Map<ActionKey<M>, Set<StoredListener>>();
  private readonly descriptors = new Map<ActionKey<M>, ActionDescriptor<M>>();

  /** Declare host actions and synchronously install their original controls. */
  registerActions(descriptors: readonly ActionDescriptor<M>[]): void {
    descriptors.forEach((descriptor) => {
      if (this.descriptors.has(descriptor.id)) {
        throw new Error(`Action "${descriptor.id}" is already registered.`);
      }
      this.descriptors.set(descriptor.id, descriptor);
      this.bindings.define(
        descriptor.id,
        descriptor.defaultSource,
        descriptor.remappable,
      );
    });
  }

  requirementsFor(action: ActionKey<M>): ActionRequirements {
    return this.descriptors.get(action)?.requirements ?? DEFAULT_REQUIREMENTS;
  }

  registeredActions(): readonly ActionKey<M>[] {
    return [...this.descriptors.keys()];
  }

  on<K extends ActionKey<M>>(action: K, listener: Listener<M[K]>): () => void {
    this.assertRegistered(action);
    const stored: StoredListener = (payload, meta) => listener(payload as M[K], meta);
    const listeners = this.listeners.get(action) ?? new Set<StoredListener>();
    listeners.add(stored);
    this.listeners.set(action, listeners);
    return () => listeners.delete(stored);
  }

  /**
   * Attempt an action already identified by a host adapter.
   * Telemetry records first; the binding gate decides dispatch second.
   */
  emit<K extends ActionKey<M>>(action: K, payload: M[K], meta: EmissionMeta): boolean {
    this.assertRegistered(action);
    const dispatched = this.bindings.isBound(action, meta.source);

    // PRE-GATE. Never move this below the binding check.
    this.telemetry.record(action, meta, dispatched);

    if (!dispatched) return false;
    this.listeners.get(action)?.forEach((listener) => listener(payload, meta));
    return true;
  }

  /** Translate a neutral channel signal only after the host supplies the action payload. */
  emitFrom<K extends ActionKey<M>>(action: K, payload: M[K], signal: InputSignal): boolean {
    return this.emit(action, payload, signal);
  }

  /** Checked public seam used by a recommendation's Accept command. */
  rebind<K extends ActionKey<M>>(action: K, source: InputSourceId): void {
    this.assertRegistered(action);
    this.bindings.set(action, source);
  }

  private assertRegistered(action: ActionKey<M>): void {
    if (!this.descriptors.has(action)) {
      throw new Error(`Action "${action}" has not been registered.`);
    }
  }
}
