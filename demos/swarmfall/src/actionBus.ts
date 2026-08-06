import type { Point } from './ui/layout.ts';

export type Squad = 'GUARDS' | 'HARVESTERS';

export const TRIGGER_GAME_ACTIONS = [
  'TOGGLE_SQUAD',
  'GATHER_UNITS',
  'SPREAD_UNITS',
  'TOGGLE_MINER_PROTECT',
  'TOGGLE_GUARD_ESCORT',
] as const;

export type TriggerGameAction = typeof TRIGGER_GAME_ACTIONS[number];
export type StrategyAction = 'TOGGLE_MINER_PROTECT' | 'TOGGLE_GUARD_ESCORT';

export type GameAction =
  | 'SELECT_SQUAD'
  | TriggerGameAction
  | 'DIRECT_UNITS'
  | 'BEGIN_ROUND'
  | 'RESTART_ROUND';

export interface ActionPayloadMap {
  SELECT_SQUAD: { squad: Squad };
  TOGGLE_SQUAD: Record<string, never>;
  GATHER_UNITS: Record<string, never>;
  SPREAD_UNITS: Record<string, never>;
  TOGGLE_MINER_PROTECT: Record<string, never>;
  TOGGLE_GUARD_ESCORT: Record<string, never>;
  DIRECT_UNITS: { direction: Point | null };
  BEGIN_ROUND: Record<string, never>;
  RESTART_ROUND: Record<string, never>;
}

type ActionListener<A extends GameAction> = (payload: ActionPayloadMap[A]) => void;

export class GameActionBus {
  private readonly listeners = new Map<GameAction, Set<ActionListener<GameAction>>>();

  on<A extends GameAction>(action: A, listener: ActionListener<A>): () => void {
    const listeners = this.listeners.get(action) ?? new Set<ActionListener<GameAction>>();
    listeners.add(listener as ActionListener<GameAction>);
    this.listeners.set(action, listeners);
    return () => listeners.delete(listener as ActionListener<GameAction>);
  }

  emit<A extends GameAction>(action: A, payload: ActionPayloadMap[A]): void {
    const listeners = this.listeners.get(action);
    listeners?.forEach((listener) => listener(payload));
  }
}
