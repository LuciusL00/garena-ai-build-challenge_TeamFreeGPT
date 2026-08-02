import type { Point } from './ui/layout.ts';
import type { StrategyId } from './strategy.ts';

export type Squad = 'GUARDS' | 'HARVESTERS';

export type GameAction =
  | 'SELECT_SQUAD'
  | 'MOVE_SQUAD_DIRECTION'
  | 'STOP_SQUAD_MOVEMENT'
  | 'SELECT_STRATEGY'
  | 'ACTIVATE_STRATEGY'
  | 'BEGIN_ROUND'
  | 'RESTART_ROUND';

export interface ActionPayloadMap {
  SELECT_SQUAD: { squad: Squad };
  MOVE_SQUAD_DIRECTION: { direction: Point };
  STOP_SQUAD_MOVEMENT: Record<string, never>;
  SELECT_STRATEGY: { strategyId: StrategyId };
  ACTIVATE_STRATEGY: Record<string, never>;
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
