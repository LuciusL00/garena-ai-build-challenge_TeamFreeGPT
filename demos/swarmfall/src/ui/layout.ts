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

export const GESTURE_MIRROR_LAYOUT = {
  top: 12,
  right: 12,
  width: 184,
  mobileWidth: 128,
  canvasWidth: 320,
  canvasHeight: 240,
} as const;

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
