export interface Point {
  x: number;
  y: number;
}

export interface ArenaLayout {
  width: number;
  height: number;
  core: Point;
}

export type SquadLayoutId = 'GUARDS' | 'HARVESTERS';

export function getArenaLayout(width: number, height: number): ArenaLayout {
  return {
    width,
    height,
    core: { x: width / 2, y: height / 2 },
  };
}

export function getInitialSquadCenter(squad: SquadLayoutId, width: number, height: number): Point {
  return squad === 'GUARDS'
    ? { x: width * 0.38, y: height * 0.42 }
    : { x: width * 0.62, y: height * 0.62 };
}
