import type { GameActionBus, Squad } from './actionBus.ts';
import type { StrategyId } from './strategy.ts';

export interface AdaptiveUiActions {
  attemptTouchToggle(): void;
  enableVisualInput(): Promise<void>;
  stopVisualInput(): void;
  useTouch(): void;
  useClosedFist(): void;
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
    const target = eventTarget.closest<HTMLElement>('[data-squad], [data-strategy], [data-action]');
    if (!target) return;

    const squad = target.dataset.squad as Squad | undefined;
    if (squad) bus.emit('SELECT_SQUAD', { squad });

    const strategyId = target.dataset.strategy as StrategyId | undefined;
    if (strategyId) bus.emit('SELECT_STRATEGY', { strategyId });

    const action = target.dataset.action;
    if (action === 'activate-strategy') bus.emit('ACTIVATE_STRATEGY', {});
    if (action === 'begin-round') bus.emit('BEGIN_ROUND', {});
    if (action === 'restart-round') bus.emit('RESTART_ROUND', {});
    if (action === 'switch-squad') adaptive.attemptTouchToggle();
    if (action === 'enable-visual-input') void adaptive.enableVisualInput();
    if (action === 'stop-visual-input') adaptive.stopVisualInput();
    if (action === 'use-touch') adaptive.useTouch();
    if (action === 'use-closed-fist') adaptive.useClosedFist();
  };

  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
