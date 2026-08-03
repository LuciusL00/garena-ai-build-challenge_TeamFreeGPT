'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalibrationHarness,
  CalibrationProfile,
  CalibrationProfileStore,
  ControlRecommender,
  InputSourceId,
  TriggerCalibrationSource,
  compareChannelScores,
  scoreCalibration,
  type ChannelScore,
  type MetricComparison,
} from '../../packages/adaptive-input/src/index.ts';
import { VisionController, type VisionStatus } from './vision-controller.ts';

const TEST_CONFIGS = {
  quick: {
    label: 'Quick test',
    trialCount: 6,
    cueDelayRangeMs: [800, 1_400] as const,
    responseTimeoutMs: 2_200,
  },
  full: {
    label: 'Full test',
    trialCount: 12,
    cueDelayRangeMs: [1_000, 1_800] as const,
    responseTimeoutMs: 2_500,
  },
} as const;
const TEST_ACTION = 'DEMO_TRIGGER';

type TestSource = 'touch' | 'fist';
type TestMode = keyof typeof TEST_CONFIGS;

export default function CalibrationClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const visionRef = useRef<VisionController | null>(null);
  const harnessRef = useRef(new CalibrationHarness());
  const touchSourceRef = useRef(
    new TriggerCalibrationSource(InputSourceId.TOUCH_BUTTON),
  );
  const fistSourceRef = useRef(
    new TriggerCalibrationSource(InputSourceId.HAND_CLOSED_FIST),
  );
  const profileRef = useRef(new CalibrationProfile());
  const storeRef = useRef<CalibrationProfileStore | null>(null);
  const runTokenRef = useRef(0);
  const activeTestRef = useRef<TestSource | null>(null);

  const [visionStatus, setVisionStatus] = useState<VisionStatus>('IDLE');
  const [visionDetail, setVisionDetail] = useState(
    'Camera access is required to test camera-based controls. Video processing stays on this device.',
  );
  const [fistState, setFistState] = useState('OPEN');
  const [fistConfidence, setFistConfidence] = useState(0);
  const [activeTest, setActiveTest] = useState<TestSource | null>(null);
  const [testMode, setTestMode] = useState<TestMode>('quick');
  const [cue, setCue] = useState('Choose a calibration');
  const [progress, setProgress] = useState('0 / 6');
  const [testDetail, setTestDetail] = useState(
    'Quick test uses six prompts. Choose Full test for twelve.',
  );
  const [scores, setScores] = useState<readonly ChannelScore[]>([]);
  const [returnHref, setReturnHref] = useState('/');

  useEffect(() => {
    setReturnHref(
      safeReturnPath(
        new URLSearchParams(window.location.search).get('return'),
        window.location.origin,
      ),
    );
    storeRef.current = new CalibrationProfileStore(window.localStorage);
    profileRef.current = storeRef.current.load();
    setScores(profileRef.current.all());

    const handleTouchAttempt = (event: PointerEvent): void => {
      if (activeTestRef.current !== 'touch') return;
      const target = event.target;
      if (target instanceof Element && target.closest('[data-calibration-control]')) return;
      touchSourceRef.current.accept({
        kind: 'trigger',
        source: InputSourceId.TOUCH_BUTTON,
        timestamp: performance.now(),
      });
    };
    window.addEventListener('pointerdown', handleTouchAttempt, true);

    const video = videoRef.current;
    if (video) {
      visionRef.current = new VisionController(video, {
        onStatus(status, detail) {
          setVisionStatus(status);
          if (detail) setVisionDetail(detail);
        },
        onFistActivation(timestamp, confidence) {
          fistSourceRef.current.accept({
            kind: 'trigger',
            source: InputSourceId.HAND_CLOSED_FIST,
            timestamp,
            confidence,
          });
        },
        onFistState(state, confidence) {
          setFistState(state);
          setFistConfidence(confidence);
        },
      });
    }

    return () => {
      window.removeEventListener('pointerdown', handleTouchAttempt, true);
      activeTestRef.current = null;
      runTokenRef.current += 1;
      harnessRef.current.abort();
      visionRef.current?.stop(false);
      visionRef.current = null;
    };
  }, []);

  const recommendation = useMemo(() => {
    const profile = new CalibrationProfile(scores);
    return new ControlRecommender().recommend(
      {
        action: TEST_ACTION,
        requirements: { task: 'TRIGGER', spatial: false, latencyCritical: false },
        currentSource: InputSourceId.TOUCH_BUTTON,
        alternativeSource: InputSourceId.HAND_CLOSED_FIST,
      },
      profile,
    );
  }, [scores]);

  const startCamera = async () => {
    await visionRef.current?.start();
  };

  const stopTest = () => {
    activeTestRef.current = null;
    runTokenRef.current += 1;
    harnessRef.current.abort();
    setActiveTest(null);
    setCue('Stopped');
    setTestDetail('No partial score was saved.');
  };

  const chooseMode = (mode: TestMode) => {
    if (activeTestRef.current !== null) return;
    setTestMode(mode);
    setProgress(`0 / ${TEST_CONFIGS[mode].trialCount}`);
    setTestDetail(
      mode === 'quick'
        ? 'Quick test uses six prompts and produces an estimate.'
        : 'Full test uses twelve prompts for a stronger comparison.',
    );
  };

  const calibrate = async (kind: TestSource) => {
    if (kind === 'fist' && visionStatus !== 'READY') {
      setTestDetail('Enable the camera and wait for Ready before testing closed fist.');
      return;
    }

    const config = TEST_CONFIGS[testMode];
    const token = runTokenRef.current + 1;
    runTokenRef.current = token;
    harnessRef.current.abort();
    activeTestRef.current = kind;
    setActiveTest(kind);
    setProgress(`0 / ${config.trialCount}`);
    setTestDetail(
      kind === 'touch'
        ? 'During WAIT, do not touch. Tap Touch action only when TAP NOW appears.'
        : 'During WAIT, keep your hand open. Make one fist only when MAKE A FIST appears.',
    );
    const source = kind === 'touch' ? touchSourceRef.current : fistSourceRef.current;
    const session = await harnessRef.current.run(
      {
        sessionId: `${kind}-${Date.now()}`,
        task: 'TRIGGER',
        action: TEST_ACTION,
        source,
      },
      {
        onWaiting(trialIndex) {
          setCue('WAIT...');
          setProgress(`${trialIndex} / ${config.trialCount}`);
        },
        onCue() {
          setCue(kind === 'touch' ? 'TAP NOW' : 'MAKE A FIST');
        },
        onTrial(trial) {
          setProgress(`${trial.trialIndex + 1} / ${config.trialCount}`);
          setCue(
            trial.outcome === 'success'
              ? `${Math.round(trial.latencyMs ?? 0)} ms`
              : trial.outcome === 'anticipated'
                ? 'TOO EARLY'
                : 'MISSED',
          );
        },
      },
      config,
    );

    if (token !== runTokenRef.current) return;
    activeTestRef.current = null;
    setActiveTest(null);
    if (session.trials.length !== config.trialCount) {
      setCue('Incomplete');
      setTestDetail('No partial score was saved.');
      return;
    }

    const score = scoreCalibration(session);
    profileRef.current.save(score);
    storeRef.current?.save(profileRef.current);
    setScores(profileRef.current.all());
    setCue('Saved');
    setTestDetail(
      `${kind === 'touch' ? 'Touch' : 'Closed fist'} result saved to this browser.`,
    );
  };

  const clearScores = () => {
    profileRef.current = new CalibrationProfile();
    storeRef.current?.clear();
    setScores([]);
    setCue('Results cleared');
  };

  const touchScore = findScore(scores, InputSourceId.TOUCH_BUTTON);
  const fistScore = findScore(scores, InputSourceId.HAND_CLOSED_FIST);
  const comparison =
    touchScore && fistScore ? compareChannelScores(touchScore, fistScore) : null;

  return (
    <main className="calibration-lab">
      <header className="lab-header">
        <a href={returnHref} data-calibration-control>← Back to controls</a>
        <span>CONTROL SETUP</span>
        <h1>Input Performance Test</h1>
        <p>
          Test your current control and an alternative. Compare detection, response time and
          accidental activations before choosing which control to use.
        </p>
      </header>

      <section className="lab-grid">
        <article className="lab-panel">
          <div className="panel-title">
            <h2>Camera input</h2>
            <span className={`vision-status ${visionStatus.toLowerCase()}`}>{visionStatus}</span>
          </div>
          <div className="camera-frame">
            <video ref={videoRef} playsInline muted />
            {visionStatus !== 'READY' && <div className="camera-placeholder">Camera preview</div>}
          </div>
          <p>{visionDetail}</p>
          <div className="reading-row">
            <span>Detected hand state</span>
            <strong>{fistState}</strong>
          </div>
          <div className="confidence-track">
            <i style={{ width: `${Math.round(fistConfidence * 100)}%` }} />
          </div>
          <div className="button-row">
            <button data-calibration-control onClick={() => void startCamera()}>Enable camera</button>
            <button data-calibration-control onClick={() => visionRef.current?.stop()}>Stop camera</button>
          </div>
        </article>

        <article className="lab-panel test-panel">
          <div className="panel-title">
            <h2>Input test</h2>
            <span>{progress}</span>
          </div>
          <div className="mode-row" aria-label="Calibration length">
            {(Object.keys(TEST_CONFIGS) as TestMode[]).map((mode) => (
              <button
                data-calibration-control
                className={testMode === mode ? 'selected' : ''}
                disabled={activeTest !== null}
                key={mode}
                onClick={() => chooseMode(mode)}
              >
                {TEST_CONFIGS[mode].label} ({TEST_CONFIGS[mode].trialCount})
              </button>
            ))}
          </div>
          <div className={`test-cue ${activeTest ? 'active' : ''}`}>{cue}</div>
          <p>{testDetail}</p>
          <div className="button-row">
            <button data-calibration-control onClick={() => void calibrate('touch')}>Test touch</button>
            <button data-calibration-control onClick={() => void calibrate('fist')}>Test closed fist</button>
            <button className="touch-action">Touch action</button>
            <button data-calibration-control onClick={stopTest}>Stop test</button>
          </div>
        </article>
      </section>

      <section className="lab-panel comparison-panel">
        <div className="panel-title">
          <h2>Results</h2>
          <button data-calibration-control onClick={clearScores}>Clear saved results</button>
        </div>
        <ComparisonTable current={touchScore} alternative={fistScore} comparison={comparison} />
        <div className={`recommendation ${recommendation.verdict}`}>
          <span>{verdictLabel(recommendation.verdict)}</span>
          <strong>{recommendation.explanation}</strong>
          <small>Your controls have not been changed. You keep the final choice.</small>
        </div>
        {touchScore && fistScore && (
          <a className="review-binding" href={returnHref} data-calibration-control>
            Review binding decision
          </a>
        )}
      </section>
    </main>
  );
}

function safeReturnPath(requested: string | null, origin: string): string {
  if (!requested) return '/';
  try {
    const parsed = new URL(requested, origin);
    if (parsed.origin !== origin) return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
}

function findScore(
  scores: readonly ChannelScore[],
  source: InputSourceId,
): ChannelScore | undefined {
  return scores.find((score) => score.task === 'TRIGGER' && score.source === source);
}

function ComparisonTable({
  current,
  alternative,
  comparison,
}: {
  current?: ChannelScore;
  alternative?: ChannelScore;
  comparison: ReturnType<typeof compareChannelScores> | null;
}) {
  return (
    <div className="comparison-scroll">
      <table className="comparison-table">
        <thead>
          <tr>
            <th>Measurement</th>
            <th>Original touch</th>
            <th>Closed fist</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Actions detected <small>higher is better</small></th>
            <MetricCell
              value={formatSuccess(current)}
              detail={evidenceLabel(current)}
              status={sideStatus(comparison?.success, 'current')}
            />
            <MetricCell
              value={formatSuccess(alternative)}
              detail={evidenceLabel(alternative)}
              status={sideStatus(comparison?.success, 'alternative')}
            />
          </tr>
          <tr>
            <th>Typical response time <small>median; lower is better</small></th>
            <MetricCell
              value={formatLatency(current)}
              status={sideStatus(comparison?.latency, 'current')}
            />
            <MetricCell
              value={formatLatency(alternative)}
              status={sideStatus(comparison?.latency, 'alternative')}
            />
          </tr>
          <tr>
            <th>Accidental activations <small>lower is better</small></th>
            <MetricCell
              value={formatFalseActivations(current)}
              detail={formatFalseActivationRate(current)}
              status={sideStatus(comparison?.falseActivations, 'current')}
            />
            <MetricCell
              value={formatFalseActivations(alternative)}
              detail={formatFalseActivationRate(alternative)}
              status={sideStatus(comparison?.falseActivations, 'alternative')}
            />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function MetricCell({
  value,
  detail,
  status,
}: {
  value: string;
  detail?: string;
  status: 'better' | 'worse' | 'similar' | 'empty';
}) {
  return (
    <td className={`metric-cell ${status}`}>
      <strong>{value}</strong>
      {detail && <span>{detail}</span>}
      <small>{metricStatusLabel(status)}</small>
    </td>
  );
}

function sideStatus(
  comparison: MetricComparison | undefined,
  side: 'current' | 'alternative',
): 'better' | 'worse' | 'similar' | 'empty' {
  if (!comparison || comparison === 'unavailable') return 'empty';
  if (comparison === 'similar') return 'similar';
  return comparison === `${side}-better` ? 'better' : 'worse';
}

function metricStatusLabel(status: 'better' | 'worse' | 'similar' | 'empty'): string {
  switch (status) {
    case 'better':
      return 'BETTER';
    case 'worse':
      return 'WORSE';
    case 'similar':
      return 'SIMILAR';
    default:
      return 'NO COMPARISON';
  }
}

function formatSuccess(score?: ChannelScore): string {
  if (!score) return 'Not calibrated';
  return `${score.successCount}/${score.trialCount} (${Math.round(score.successRate * 100)}%)`;
}

function formatLatency(score?: ChannelScore): string {
  if (!score || score.medianLatencyMs === null) return 'No successful response';
  return `${Math.round(score.medianLatencyMs)} ms`;
}

function formatFalseActivations(score?: ChannelScore): string {
  if (!score) return 'Not calibrated';
  return `${score.falseActivationCount} in ${formatDuration(score.falseActivationObservationMs)}`;
}

function formatFalseActivationRate(score?: ChannelScore): string | undefined {
  if (!score) return undefined;
  return `${score.falseActivationsPerMinute.toFixed(1)}/min estimate`;
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1_000).toFixed(1)} sec WAIT`;
}

function evidenceLabel(score?: ChannelScore): string | undefined {
  if (!score) return undefined;
  return score.trialCount >= 12 ? 'Full test' : 'Quick estimate';
}

function verdictLabel(verdict: string): string {
  switch (verdict) {
    case 'swap':
      return 'ALTERNATIVE INPUT PERFORMED BETTER';
    case 'keep':
      return 'KEEP CURRENT INPUT';
    case 'trade-off':
      return 'TRADE-OFF — YOU CHOOSE';
    case 'retest':
      return 'RETEST BOTH CONTROLS';
    default:
      return 'CALIBRATION NEEDED';
  }
}
