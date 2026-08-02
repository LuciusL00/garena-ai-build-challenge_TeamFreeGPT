export interface Point {
  x: number;
  y: number;
}

export interface ArenaLayout {
  width: number;
  height: number;
  core: Point;
}

export function getArenaLayout(width: number, height: number): ArenaLayout {
  return {
    width,
    height,
    core: { x: width / 2, y: height / 2 },
  };
}

export function getInitialSquadCenter(
  squad: 'GUARDS' | 'HARVESTERS',
  width: number,
  height: number,
): Point {
  if (squad === 'GUARDS') {
    return { x: width * 0.34, y: height * 0.34 };
  }

  return { x: width * 0.66, y: height * 0.68 };
}
