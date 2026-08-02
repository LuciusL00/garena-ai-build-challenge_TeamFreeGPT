import type { GameActionBus, Squad } from './actionBus.ts';
import { BALANCE } from './config/balance.ts';
import type { StrategyId } from './strategy.ts';

interface PointerPosition {
  x: number;
  y: number;
}

function pointerPosition(event: PointerEvent): PointerPosition {
  return { x: event.clientX, y: event.clientY };
}

function joystickDirection(origin: PointerPosition, current: PointerPosition) {
  const delta = { x: current.x - origin.x, y: current.y - origin.y };
  const distance = Math.hypot(delta.x, delta.y);
  if (distance <= BALANCE.joystickDeadZonePx) return { x: 0, y: 0 };

  const magnitude = Math.min(
    1,
    (distance - BALANCE.joystickDeadZonePx) /
      (BALANCE.joystickMaxDragPx - BALANCE.joystickDeadZonePx),
  );
  return {
    x: (delta.x / distance) * magnitude,
    y: (delta.y / distance) * magnitude,
  };
}

export function wireCanvasInput(canvas: HTMLCanvasElement, bus: GameActionBus): () => void {
  let activePointer: number | null = null;
  let origin: PointerPosition | null = null;

  const onPointerDown = (event: PointerEvent) => {
    if (activePointer !== null) return;
    activePointer = event.pointerId;
    origin = pointerPosition(event);
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    bus.emit('MOVE_SQUAD_DIRECTION', { direction: { x: 0, y: 0 } });
  };

  const onPointerMove = (event: PointerEvent) => {
    if (activePointer !== event.pointerId || !origin) return;
    event.preventDefault();
    bus.emit('MOVE_SQUAD_DIRECTION', {
      direction: joystickDirection(origin, pointerPosition(event)),
    });
  };

  const finish = (event: PointerEvent) => {
    if (activePointer !== event.pointerId) return;
    event.preventDefault();
    bus.emit('STOP_SQUAD_MOVEMENT', {});
    activePointer = null;
    origin = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', finish);
    canvas.removeEventListener('pointercancel', finish);
  };
}

export function wireUiInput(root: HTMLElement, bus: GameActionBus): () => void {
  const onClick = (event: Event) => {
    const eventTarget = event.target;
    if (!(eventTarget instanceof HTMLElement)) return;
    const target = eventTarget.closest<HTMLElement>('[data-squad], [data-strategy], [data-action]');
    if (!target) return;

    const squad = target.dataset.squad as Squad | undefined;
    if (squad) bus.emit('SELECT_SQUAD', { squad });

    const strategyId = target.dataset.strategy as StrategyId | undefined;
    if (strategyId) bus.emit('SELECT_STRATEGY', { strategyId });

    if (target.dataset.action === 'activate-strategy') bus.emit('ACTIVATE_STRATEGY', {});
    if (target.dataset.action === 'begin-round') bus.emit('BEGIN_ROUND', {});
    if (target.dataset.action === 'restart-round') bus.emit('RESTART_ROUND', {});
  };

  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
