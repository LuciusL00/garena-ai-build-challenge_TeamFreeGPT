/** Which input source currently drives each host action. */

import type { ActionId } from './actions.ts';
import { InputChannelId, InputSourceId, channelOf } from './sources.ts';

export type BindingChangeListener<A extends ActionId = ActionId> = (
  action: A,
  source: InputSourceId,
  previous: InputSourceId,
) => void;

/**
 * One action has one current source. A source may drive several actions.
 *
 * That second rule is essential for original touch controls: one touch-button
 * source can legitimately back Begin, Restart, and several menu buttons.
 */
export class BindingMap<A extends ActionId = ActionId> {
  private readonly bindings = new Map<A, InputSourceId>();
  private readonly remappable = new Set<A>();
  private readonly listeners = new Set<BindingChangeListener<A>>();

  /** Called once when a host registers an action. */
  define(action: A, defaultSource: InputSourceId, canRemap: boolean): void {
    if (this.bindings.has(action)) {
      throw new Error(`Action "${action}" already has a binding definition.`);
    }
    this.bindings.set(action, defaultSource);
    if (canRemap) this.remappable.add(action);
  }

  get(action: A): InputSourceId | undefined {
    return this.bindings.get(action);
  }

  isRemappable(action: A): boolean {
    return this.remappable.has(action);
  }

  /** Rebind a declared remappable action. Fixed defaults cannot be bypassed. */
  set(action: A, source: InputSourceId): void {
    const previous = this.bindings.get(action);
    if (previous === undefined) {
      throw new Error(`Cannot bind unregistered action "${action}".`);
    }
    if (previous === source) return;
    if (!this.remappable.has(action)) {
      throw new Error(`Action "${action}" keeps its original input and cannot be remapped.`);
    }

    this.bindings.set(action, source);
    this.listeners.forEach((listener) => listener(action, source, previous));
  }

  isBound(action: A, source: InputSourceId): boolean {
    return this.bindings.get(action) === source;
  }

  entries(): ReadonlyArray<readonly [A, InputSourceId]> {
    return [...this.bindings.entries()];
  }

  activeChannels(): ReadonlySet<InputChannelId> {
    const active = new Set<InputChannelId>();
    this.bindings.forEach((source) => active.add(channelOf(source)));
    return active;
  }

  onChange(listener: BindingChangeListener<A>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
