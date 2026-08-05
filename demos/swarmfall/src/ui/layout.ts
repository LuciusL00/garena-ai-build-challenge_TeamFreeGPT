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
