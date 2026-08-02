/**
 * Game action declarations.
 *
 * The host supplies the action names and payloads. The layer only knows each
 * action's input requirements, original source, and whether the player may
 * remap it.
 */

import type { InputSourceId } from './sources.ts';

/** Base type used by game-independent records and persisted data. */
export type ActionId = string;

/** The exact string action names declared by one host game's payload map. */
export type ActionKey<M extends object> = Extract<keyof M, string>;

export interface ActionRequirements {
  /** Needs precise continuous positioning, such as drawing a lasso. */
  spatial: boolean;
  /** Does not tolerate meaningful added input latency. */
  latencyCritical: boolean;
}

export interface ActionDescriptor<
  M extends object,
  K extends ActionKey<M> = ActionKey<M>,
> {
  id: K;
  requirements: ActionRequirements;
  /** The game's original control. Installed synchronously at registration. */
  defaultSource: InputSourceId;
  /** False keeps the original control and excludes the action from remapping. */
  remappable: boolean;
}

export const DEFAULT_REQUIREMENTS: ActionRequirements = {
  spatial: false,
  latencyCritical: false,
};
