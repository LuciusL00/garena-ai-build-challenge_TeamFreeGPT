'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { InputSourceId, type VisionStatus } from '../../packages/adaptive-input/src/index.ts';
import {
  Adaptive2048Input,
  type MoveDirection,
  type Portability2048Source,
} from '../../demos/2048-portability/src/adaptive2048.ts';

type UpstreamEvent = 'move' | 'restart' | 'keepPlaying';
type UpstreamListener = (value?: number) => void;

class BridgeInputManager {
  private readonly listeners = new Map<UpstreamEvent, Set<UpstreamListener>>();

  on(event: UpstreamEvent, listener: UpstreamListener): void {
    const listeners = this.listeners.get(event) ?? new Set<UpstreamListener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  emit(event: UpstreamEvent, value?: number): void {
    this.listeners.get(event)?.forEach((listener) => listener(value));
  }
}

class PortabilityStorageManager {
  private readonly bestScoreKey = 'teamfreegpt.2048.best-score.v1';
  private readonly gameStateKey = 'teamfreegpt.2048.game-state.v1';

  getBestScore(): number {
    return Number.parseInt(window.localStorage.getItem(this.bestScoreKey) ?? '0', 10) || 0;
  }

  setBestScore(score: number): void {
    window.localStorage.setItem(this.bestScoreKey, String(score));
  }

  getGameState(): unknown {
    const serialized = window.localStorage.getItem(this.gameStateKey);
    if (!serialized) return null;
    try {
      return JSON.parse(serialized) as unknown;
    } catch {
      return null;
    }
  }

  setGameState(state: unknown): void {
    window.localStorage.setItem(this.gameStateKey, JSON.stringify(state));
  }

  clearGameState(): void {
    window.localStorage.removeItem(this.gameStateKey);
  }
}

interface UpstreamGameManager {
  readonly inputManager: BridgeInputManager;
}

type UpstreamGameManagerConstructor = new (
  size: number,
  InputManager: new () => BridgeInputManager,
  Actuator: new () => unknown,
  StorageManager: new () => PortabilityStorageManager,
) => UpstreamGameManager;

interface Upstream2048Window extends Window {
  GameManager?: UpstreamGameManagerConstructor;
  HTMLActuator?: new () => unknown;
}

const UPSTREAM_SCRIPTS = [
  '/2048/js/tile.js',
  '/2048/js/grid.js',
  '/2048/js/html_actuator.js',
  '/2048/js/game_manager.js',
] as const;

const DIRECTION_INDEX: Record<MoveDirection, number> = {
  up: 0,
  right: 1,
  down: 2,
  left: 3,
};

const DIRECTION_LABEL: Record<MoveDirection, string> = {
  up: 'Up',
  right: 'Right',
  down: 'Down',
  left: 'Left',
};

const SOURCE_LABEL: Record<Portability2048Source, string> = {
  [InputSourceId.TOUCH_DIRECTION]: 'Touch direction',
  [InputSourceId.HAND_POINT_DIRECTION]: 'Hand point direction',
};

export default function Portability2048Client() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const gameRef = useRef<UpstreamGameManager | null>(null);
  const adaptiveRef = useRef<Adaptive2048Input | null>(null);
  const pointerStartRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const [runtime, setRuntime] = useState<'LOADING' | 'READY' | 'ERROR'>('LOADING');
  const [binding, setBinding] = useState<Portability2048Source>(InputSourceId.TOUCH_DIRECTION);
  const [visionStatus, setVisionStatus] = useState<VisionStatus>('IDLE');
  const [visionDetail, setVisionDetail] = useState('Camera remains off while touch is selected.');
  const [detectedDirection, setDetectedDirection] = useState<MoveDirection | null>(null);
  const [lastAttempt, setLastAttempt] = useState('No move attempted yet.');
  const [acceptedAttempts, setAcceptedAttempts] = useState(0);
  const [rejectedAttempts, setRejectedAttempts] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;

    const adaptive = new Adaptive2048Input(video, {
      onMove(direction) {
        gameRef.current?.inputManager.emit('move', DIRECTION_INDEX[direction]);
      },
      onBindingChanged(source) {
        setBinding(source);
      },
      onVisionStatus(status, detail) {
        setVisionStatus(status);
        setVisionDetail(detail ?? '');
      },
      onDetectedDirection(direction) {
        setDetectedDirection(direction);
      },
      onAttempt(attempt) {
        setLastAttempt(
          `${SOURCE_LABEL[attempt.source]} · ${DIRECTION_LABEL[attempt.direction]} · ${
            attempt.accepted ? 'accepted' : 'rejected by binding'
          }`,
        );
      },
      onTelemetry(record) {
        if (record.dispatched) setAcceptedAttempts((value) => value + 1);
        else setRejectedAttempts((value) => value + 1);
      },
    });
    adaptiveRef.current = adaptive;

    void loadUpstreamScripts()
      .then(() => {
        if (cancelled) return;
        const upstream = window as Upstream2048Window;
        if (!upstream.GameManager || !upstream.HTMLActuator) {
          throw new Error('The pinned 2048 runtime did not expose its expected constructors.');
        }
        gameRef.current = new upstream.GameManager(
          4,
          BridgeInputManager,
          upstream.HTMLActuator,
          PortabilityStorageManager,
        );
        setRuntime('READY');
      })
      .catch(() => {
        if (!cancelled) setRuntime('ERROR');
      });

    return () => {
      cancelled = true;
      adaptive.dispose();
      adaptiveRef.current = null;
      gameRef.current = null;
    };
  }, []);

  const attemptTouch = (direction: MoveDirection): void => {
    if (runtime !== 'READY') return;
    adaptiveRef.current?.attemptTouch(direction);
  };

  const selectSource = async (source: Portability2048Source): Promise<void> => {
    const adaptive = adaptiveRef.current;
    if (!adaptive || source === binding) return;
    const changed = await adaptive.selectSource(source);
    if (!changed) setLastAttempt('Camera could not start. Touch direction remains active.');
  };

  const newGame = (): void => {
    gameRef.current?.inputManager.emit('restart');
  };

  const keepPlaying = (): void => {
    gameRef.current?.inputManager.emit('keepPlaying');
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.isPrimary || runtime !== 'READY') return;
    pointerStartRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    attemptTouch(
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up',
    );
  };

  return (
    <main className="p2048-shell">
      <header className="p2048-header">
        <div>
          <span className="p2048-eyebrow">Independent open-source host</span>
          <h1>Adaptive 2048</h1>
        </div>
        <nav aria-label="Portability routes">
          <a href="/portability">Pulse Host</a>
          <a href="/">Swarmfall</a>
        </nav>
      </header>

      <section className="p2048-intro">
        <p>
          The original MIT-licensed 2048 grid and move logic run unchanged. A small host adapter
          maps touch swipes or hand direction to one semantic <code>MOVE_TILES</code> action.
        </p>
      </section>

      <section className="p2048-layout">
        <article className="p2048-game-card">
          <div className="p2048-game-heading">
            <div>
              <span className="p2048-eyebrow">Pinned upstream game</span>
              <strong>2048</strong>
            </div>
            <div className="scores-container">
              <div className="score-container">0</div>
              <div className="best-container">0</div>
            </div>
          </div>

          <div
            className="game-container"
            aria-label="2048 board. Swipe to move tiles."
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => {
              pointerStartRef.current = null;
            }}
          >
            <div className="game-message">
              <p />
              <div className="game-message-actions">
                <button type="button" className="keep-playing-button" onClick={keepPlaying}>
                  Keep going
                </button>
                <button type="button" className="retry-button" onClick={newGame}>
                  Try again
                </button>
              </div>
            </div>
            <div className="grid-container">
              {Array.from({ length: 4 }, (_, row) => (
                <div className="grid-row" key={row}>
                  {Array.from({ length: 4 }, (_, column) => (
                    <div className="grid-cell" key={column} />
                  ))}
                </div>
              ))}
            </div>
            <div className="tile-container" />
            {runtime !== 'READY' ? (
              <div className="p2048-runtime-state">
                {runtime === 'LOADING' ? 'Loading pinned game logic…' : '2048 could not start.'}
              </div>
            ) : null}
          </div>

          <div className="p2048-touch-controls" aria-label="Touch direction controls">
            <button type="button" onClick={() => attemptTouch('up')}>↑</button>
            <button type="button" onClick={() => attemptTouch('left')}>←</button>
            <button type="button" onClick={() => attemptTouch('down')}>↓</button>
            <button type="button" onClick={() => attemptTouch('right')}>→</button>
            <button type="button" className="p2048-new-game" onClick={newGame}>New game</button>
          </div>
        </article>

        <aside className="p2048-adapter-card">
          <span className="p2048-eyebrow">Game-semantic adapter</span>
          <h2>MOVE_TILES</h2>
          <p>Current input: <strong>{SOURCE_LABEL[binding]}</strong></p>

          <div className="p2048-source-buttons">
            <button
              type="button"
              className={binding === InputSourceId.TOUCH_DIRECTION ? 'selected' : ''}
              disabled={binding === InputSourceId.TOUCH_DIRECTION}
              onClick={() => void selectSource(InputSourceId.TOUCH_DIRECTION)}
            >
              Use touch direction
            </button>
            <button
              type="button"
              className={binding === InputSourceId.HAND_POINT_DIRECTION ? 'selected' : ''}
              disabled={binding === InputSourceId.HAND_POINT_DIRECTION}
              onClick={() => void selectSource(InputSourceId.HAND_POINT_DIRECTION)}
            >
              Use hand direction
            </button>
          </div>

          <div className="p2048-camera-frame">
            <video ref={videoRef} muted playsInline />
            <span>{detectedDirection ? DIRECTION_LABEL[detectedDirection] : 'Relaxed'}</span>
          </div>
          <p className="p2048-camera-status"><strong>{visionStatus}</strong> {visionDetail}</p>
          <p className="p2048-instruction">
            Point in one direction, hold briefly, then relax before the next move.
          </p>

          <div className="p2048-attempt-panel">
            <p>{lastAttempt}</p>
            <div>
              <span>Accepted <strong>{acceptedAttempts}</strong></span>
              <span>Rejected <strong>{rejectedAttempts}</strong></span>
            </div>
          </div>

          <p className="p2048-proof-note">
            Rejected attempts are still recorded before the binding gate. No 2048 action name
            exists in the reusable package.
          </p>
        </aside>
      </section>

      <footer className="p2048-footer">
        Original game by Gabriele Cirulli, imported from commit <code>478b6ec</code> under the{' '}
        <a href="/2048/LICENSE.txt">MIT License</a>. This route is an integration test, not an
        original TeamFreeGPT game.
      </footer>
    </main>
  );
}

async function loadUpstreamScripts(): Promise<void> {
  for (const source of UPSTREAM_SCRIPTS) await loadScript(source);
}

function loadScript(source: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[data-upstream-2048="${source}"]`);
  if (existing?.dataset.loaded === 'true') return Promise.resolve();
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Could not load ${source}`)), {
        once: true,
      });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source;
    script.async = false;
    script.dataset.upstream2048 = source;
    script.addEventListener(
      'load',
      () => {
        script.dataset.loaded = 'true';
        resolve();
      },
      { once: true },
    );
    script.addEventListener('error', () => reject(new Error(`Could not load ${source}`)), {
      once: true,
    });
    document.head.appendChild(script);
  });
}
