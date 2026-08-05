import type { GameActionBus } from './actionBus.ts';
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

function canvasPoint(canvas: HTMLCanvasElement, event: PointerEvent) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * canvas.clientWidth,
    y: ((event.clientY - bounds.top) / bounds.height) * canvas.clientHeight,
  };
}

export function wireCanvasInput(canvas: HTMLCanvasElement, adaptive: AdaptiveUiActions): () => void {
  let activePointer: number | null = null;

  const onPointerDown = (event: PointerEvent) => {
    if (activePointer !== null) return;
    activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    const point = canvasPoint(canvas, event);
    const centre = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    const length = Math.hypot(point.x - centre.x, point.y - centre.y) || 1;
    adaptive.attemptTouchDirection({ x: (point.x - centre.x) / length, y: (point.y - centre.y) / length });
  };

  const onPointerMove = (event: PointerEvent) => {
    if (activePointer !== event.pointerId) return;
    event.preventDefault();
    const point = canvasPoint(canvas, event);
    const centre = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    const length = Math.hypot(point.x - centre.x, point.y - centre.y) || 1;
    adaptive.attemptTouchDirection({ x: (point.x - centre.x) / length, y: (point.y - centre.y) / length });
  };

  const finish = (event: PointerEvent) => {
    if (activePointer !== event.pointerId) return;
    event.preventDefault();
    adaptive.attemptTouchDirection(null);
    activePointer = null;
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
