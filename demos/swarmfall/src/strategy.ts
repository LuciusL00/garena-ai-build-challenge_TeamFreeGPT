export type StrategyId = 'MINER_PROTECT' | 'ESCORT' | 'SPREAD';

export type GuardPolicy = 'INTERCEPT_THREATS' | 'ESCORT_LOADED_MINER' | 'SPREAD_FORMATION';
export type HarvesterPolicy = 'MINE_AND_BANK' | 'PROTECT_LOADED_MINER' | 'SPREAD_FORMATION';

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
    description: 'Empty miners escort a loaded miner home while the rest keep extracting.',
    guardPolicy: 'INTERCEPT_THREATS',
    harvesterPolicy: 'PROTECT_LOADED_MINER',
  },
  {
    id: 'ESCORT',
    label: 'Guard Escort',
    description: 'A guard follows each loaded miner inside the guard activity zone.',
    guardPolicy: 'ESCORT_LOADED_MINER',
    harvesterPolicy: 'MINE_AND_BANK',
  },
  {
    id: 'SPREAD',
    label: 'Spread Formation',
    description: 'Both squads use a wider formation around their activity centres.',
    guardPolicy: 'SPREAD_FORMATION',
    harvesterPolicy: 'SPREAD_FORMATION',
  },
];

export function getStrategy(id: StrategyId): StrategyDefinition {
  return STRATEGIES.find((strategy) => strategy.id === id) ?? STRATEGIES[0];
}

export function isStrategyId(value: string): value is StrategyId {
  return STRATEGIES.some((strategy) => strategy.id === value);
}
