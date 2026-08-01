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

export function getDefaultLasso(
  squad: 'GUARDS' | 'HARVESTERS',
  width: number,
  height: number,
): Point[] {
  if (squad === 'GUARDS') {
    return [
      { x: width * 0.08, y: height * 0.1 },
      { x: width * 0.92, y: height * 0.1 },
      { x: width * 0.9, y: height * 0.56 },
      { x: width * 0.1, y: height * 0.56 },
    ];
  }

  return [
    { x: width * 0.1, y: height * 0.52 },
    { x: width * 0.9, y: height * 0.52 },
    { x: width * 0.92, y: height * 0.91 },
    { x: width * 0.08, y: height * 0.91 },
  ];
}
