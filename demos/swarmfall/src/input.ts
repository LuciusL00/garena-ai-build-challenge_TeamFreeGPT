import type { GameActionBus } from './actionBus.ts';
import type { StrategyId } from './strategy.ts';

export interface AdaptiveUiActions {
  attemptTouchToggle(): void;
  openSettings(): void;
  closeSettings(): void;
  selectSettingsAction(actionId: string): void;
  selectSettingsSource(sourceId: string): void;
  confirmSelectedBinding(): Promise<void>;
  resetSelectedBinding(): void;
}

function canvasPoint(canvas: HTMLCanvasElement, event: PointerEvent) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * canvas.clientWidth,
    y: ((event.clientY - bounds.top) / bounds.height) * canvas.clientHeight,
  };
}

export function wireCanvasInput(canvas: HTMLCanvasElement, bus: GameActionBus): () => void {
  let activePointer: number | null = null;

  const onPointerDown = (event: PointerEvent) => {
    if (activePointer !== null) return;
    activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    bus.emit('LASSO_START', { point: canvasPoint(canvas, event) });
  };

  const onPointerMove = (event: PointerEvent) => {
    if (activePointer !== event.pointerId) return;
    event.preventDefault();
    bus.emit('LASSO_POINT', { point: canvasPoint(canvas, event) });
  };

  const finish = (event: PointerEvent) => {
    if (activePointer !== event.pointerId) return;
    event.preventDefault();
    bus.emit('LASSO_END', { point: canvasPoint(canvas, event) });
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
    if (action === 'activate-strategy') bus.emit('ACTIVATE_STRATEGY', {});
    if (action === 'begin-round') bus.emit('BEGIN_ROUND', {});
    if (action === 'restart-round') bus.emit('RESTART_ROUND', {});
    if (action === 'switch-squad') adaptive.attemptTouchToggle();
    if (action === 'open-adaptive-settings') adaptive.openSettings();
    if (action === 'close-adaptive-settings') adaptive.closeSettings();
    if (action === 'confirm-adaptive-binding') void adaptive.confirmSelectedBinding();
    if (action === 'reset-adaptive-binding') adaptive.resetSelectedBinding();
  };

  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
