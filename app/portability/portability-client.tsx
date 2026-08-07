'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AdaptiveInput,
  InputSourceId,
  VisionInputChannel,
  type InputSignal,
  type VisionStatus,
} from '../../packages/adaptive-input/src/index.ts';

type EmptyPayload = Record<string, never>;

interface PortabilityActions {
  ACTIVATE: EmptyPayload;
}

const SOURCE_LABEL: Record<InputSourceId.TOUCH_BUTTON | InputSourceId.HAND_CLOSED_FIST, string> = {
  [InputSourceId.TOUCH_BUTTON]: 'Touch button',
  [InputSourceId.HAND_CLOSED_FIST]: 'Closed fist',
};

export default function PortabilityClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const adaptiveRef = useRef<AdaptiveInput<PortabilityActions> | null>(null);
  const visionRef = useRef<VisionInputChannel | null>(null);
  const [binding, setBinding] = useState<InputSourceId.TOUCH_BUTTON | InputSourceId.HAND_CLOSED_FIST>(
    InputSourceId.TOUCH_BUTTON,
  );
  const [visionStatus, setVisionStatus] = useState<VisionStatus>('IDLE');
  const [visionDetail, setVisionDetail] = useState('Camera remains off while touch is selected.');
  const [activations, setActivations] = useState(0);
  const [acceptedAttempts, setAcceptedAttempts] = useState(0);
  const [rejectedAttempts, setRejectedAttempts] = useState(0);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const adaptive = new AdaptiveInput<PortabilityActions>();
    adaptive.registerActions([
      {
        id: 'ACTIVATE',
        requirements: { task: 'TRIGGER', spatial: false, latencyCritical: false },
        defaultSource: InputSourceId.TOUCH_BUTTON,
        remappable: true,
      },
    ]);
    const stopAction = adaptive.on('ACTIVATE', () => {
      setActivations((value) => value + 1);
      setPulse(true);
      window.setTimeout(() => setPulse(false), 180);
    });
    const stopTelemetry = adaptive.telemetry.subscribe((record) => {
      if (record.dispatched) setAcceptedAttempts((value) => value + 1);
      else setRejectedAttempts((value) => value + 1);
    });
    const vision = new VisionInputChannel(video, {
      onStatus(status, detail) {
        setVisionStatus(status);
        setVisionDetail(detail);
      },
    });

    adaptiveRef.current = adaptive;
    visionRef.current = vision;
    return () => {
      stopAction();
      stopTelemetry();
      vision.stop();
      adaptiveRef.current = null;
      visionRef.current = null;
    };
  }, []);

  const handleVisionSignal = (signal: InputSignal): void => {
    if (signal.kind !== 'trigger' || signal.source !== InputSourceId.HAND_CLOSED_FIST) return;
    adaptiveRef.current?.emitFrom('ACTIVATE', {}, signal);
  };

  const selectSource = async (
    source: InputSourceId.TOUCH_BUTTON | InputSourceId.HAND_CLOSED_FIST,
  ): Promise<void> => {
    const adaptive = adaptiveRef.current;
    const vision = visionRef.current;
    if (!adaptive || !vision || source === binding) return;

    if (source === InputSourceId.HAND_CLOSED_FIST) {
      try {
        await vision.start({ emit: handleVisionSignal });
      } catch {
        setVisionDetail('Visual input could not start. Touch remains selected.');
        return;
      }
    }

    adaptive.rebind('ACTIVATE', source);
    setBinding(source);
    if (source === InputSourceId.TOUCH_BUTTON) {
      vision.stop();
      setVisionDetail('Camera stopped. Touch is the active input.');
    }
  };

  const attemptTouch = (): void => {
    adaptiveRef.current?.emit('ACTIVATE', {}, {
      kind: 'trigger',
      source: InputSourceId.TOUCH_BUTTON,
      timestamp: performance.now(),
      phase: 'gameplay',
    });
  };

  return (
    <main className="portability-shell">
      <header>
        <div>
          <span className="portability-eyebrow">Portability proof</span>
          <h1>Pulse Host</h1>
        </div>
        <a href="/">Back to Swarmfall</a>
      </header>

      <section className="portability-intro">
        <p>
          This host declares one action through the public adaptive-input API. It has no Swarmfall
          imports, units, strategies or game adapter.
        </p>
      </section>

      <section className="pulse-grid">
        <article className="pulse-stage">
          <div className={`pulse-orb ${pulse ? 'active' : ''}`} aria-live="polite">
            <strong>{activations}</strong>
            <span>accepted activations</span>
          </div>
          <button className="activate-button" onClick={attemptTouch}>
            Activate with touch
          </button>
          <div className="attempt-counts">
            <span>Accepted attempts <strong>{acceptedAttempts}</strong></span>
            <span>Rejected attempts <strong>{rejectedAttempts}</strong></span>
          </div>
        </article>

        <article className="binding-card">
          <span className="portability-eyebrow">Action binding</span>
          <h2>ACTIVATE</h2>
          <p>Current input: <strong>{SOURCE_LABEL[binding]}</strong></p>
          <div className="source-buttons">
            <button
              className={binding === InputSourceId.TOUCH_BUTTON ? 'selected' : ''}
              disabled={binding === InputSourceId.TOUCH_BUTTON}
              onClick={() => void selectSource(InputSourceId.TOUCH_BUTTON)}
            >
              Use touch
            </button>
            <button
              className={binding === InputSourceId.HAND_CLOSED_FIST ? 'selected' : ''}
              disabled={binding === InputSourceId.HAND_CLOSED_FIST}
              onClick={() => void selectSource(InputSourceId.HAND_CLOSED_FIST)}
            >
              Use closed fist
            </button>
          </div>
          <div className="camera-frame">
            <video ref={videoRef} muted playsInline />
          </div>
          <p className="camera-status"><strong>{visionStatus}</strong> {visionDetail}</p>
        </article>
      </section>
    </main>
  );
}
