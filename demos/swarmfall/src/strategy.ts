export type StrategyId = 'MINER_PROTECT' | 'ESCORT';

export type GuardPolicy = 'INTERCEPT_THREATS' | 'ESCORT_LOADED_MINER';
export type HarvesterPolicy = 'MINE_AND_BANK' | 'PROTECT_LOADED_MINER';

export interface StrategyDefinition {
  id: StrategyId;
  label: string;
  description: string;
  guardPolicy: GuardPolicy;
  harvesterPolicy: HarvesterPolicy;
}

export const STRATEGIES: readonly StrategyDefinition[] = [
  {
    id: 'MINER_PROTECT',
    label: 'Miner Protect',
    description: 'Empty miners escort loaded miners home.',
    guardPolicy: 'INTERCEPT_THREATS',
    harvesterPolicy: 'PROTECT_LOADED_MINER',
  },
  {
    id: 'ESCORT',
    label: 'Guard Escort',
    description: 'A guard escorts each loaded miner.',
    guardPolicy: 'ESCORT_LOADED_MINER',
    harvesterPolicy: 'MINE_AND_BANK',
  },
];

export function getStrategy(id: StrategyId): StrategyDefinition {
  return STRATEGIES.find((strategy) => strategy.id === id) ?? STRATEGIES[0];
}

export function isStrategyId(value: string): value is StrategyId {
  return STRATEGIES.some((strategy) => strategy.id === value);
}
