import type { GameActionBus } from './actionBus.ts';
import { BALANCE } from './config/balance.ts';
import type { StrategyId } from './strategy.ts';

export interface AdaptiveUiActions {
  attemptTouchAction(action: 'GATHER_UNITS' | 'SPREAD_UNITS' | 'TOGGLE_SQUAD'): void;
  attemptTouchDirection(direction: { x: number; y: number } | null): void;
  openSettings(): void;
  closeSettings(): void;
  selectSettingsAction(actionId: string): void;
  selectSettingsSource(sourceId: string): void;
  reviewSelectedBinding(): void;
  startSelectedCalibration(): void;
  keepCurrentBinding(): void;
  confirmSelectedBinding(): Promise<void>;
  resetSelectedBinding(): void;
  startTraining(): Promise<void>;
  stopTraining(): void;
}

interface PointerPosition {
  x: number;
  y: number;
}

function pointerPosition(event: PointerEvent): PointerPosition {
  return { x: event.clientX, y: event.clientY };
}

function joystickDirection(origin: PointerPosition, current: PointerPosition): { x: number; y: number } | null {
  const delta = { x: current.x - origin.x, y: current.y - origin.y };
  const length = Math.hypot(delta.x, delta.y);
  if (length <= BALANCE.joystickDeadZonePx) return null;
  return { x: delta.x / length, y: delta.y / length };
}

export function wireCanvasInput(canvas: HTMLCanvasElement, adaptive: AdaptiveUiActions): () => void {
  let activePointer: number | null = null;
  let origin: PointerPosition | null = null;

  const onPointerDown = (event: PointerEvent) => {
    if (activePointer !== null) return;
    activePointer = event.pointerId;
    origin = pointerPosition(event);
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    adaptive.attemptTouchDirection(null);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (activePointer !== event.pointerId || !origin) return;
    event.preventDefault();
    adaptive.attemptTouchDirection(joystickDirection(origin, pointerPosition(event)));
  };

  const finish = (event: PointerEvent) => {
    if (activePointer !== event.pointerId) return;
    event.preventDefault();
    adaptive.attemptTouchDirection(null);
    activePointer = null;
    origin = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  return () => {
    if (activePointer !== null) adaptive.attemptTouchDirection(null);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', finish);
    canvas.removeEventListener('pointercancel', finish);
  };
}

export function wireUiInput(
  root: HTMLElement,
  bus: GameActionBus,
  adaptive: AdaptiveUiActions,
): () => void {
  const onClick = (event: Event) => {
    const eventTarget = event.target;
    if (!(eventTarget instanceof HTMLElement)) return;
    const target = eventTarget.closest<HTMLElement>(
      '[data-strategy], [data-action], [data-binding-action], [data-input-source]',
    );
    if (!target) return;

    const strategyId = target.dataset.strategy as StrategyId | undefined;
    if (strategyId) bus.emit('SELECT_STRATEGY', { strategyId });

    if (target.dataset.bindingAction) {
      adaptive.selectSettingsAction(target.dataset.bindingAction);
    }
    if (target.dataset.inputSource) {
      adaptive.selectSettingsSource(target.dataset.inputSource);
    }

    const action = target.dataset.action;
    if (action === 'begin-round') bus.emit('BEGIN_ROUND', {});
    if (action === 'restart-round') bus.emit('RESTART_ROUND', {});
    if (action === 'switch-squad') adaptive.attemptTouchAction('TOGGLE_SQUAD');
    if (action === 'gather-units') adaptive.attemptTouchAction('GATHER_UNITS');
    if (action === 'spread-units') adaptive.attemptTouchAction('SPREAD_UNITS');
    if (action === 'open-adaptive-settings') adaptive.openSettings();
    if (action === 'close-adaptive-settings') adaptive.closeSettings();
    if (action === 'review-adaptive-binding') adaptive.reviewSelectedBinding();
    if (action === 'start-adaptive-calibration') adaptive.startSelectedCalibration();
    if (action === 'keep-current-binding') adaptive.keepCurrentBinding();
    if (action === 'confirm-adaptive-binding') void adaptive.confirmSelectedBinding();
    if (action === 'reset-adaptive-binding') adaptive.resetSelectedBinding();
    if (action === 'start-gesture-training') void adaptive.startTraining();
    if (action === 'stop-gesture-training') adaptive.stopTraining();
  };

  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
