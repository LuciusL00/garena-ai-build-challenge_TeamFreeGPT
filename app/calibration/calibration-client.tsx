'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  CalibrationHarness,
  CalibrationProfile,
  CalibrationProfileStore,
  ControlRecommender,
  DirectionCalibrationHarness,
  DirectionSignalSource,
  InputSourceId,
  TriggerCalibrationSource,
  VisionInputChannel,
  compareChannelScores,
  scoreCalibration,
  scoreDirectionCalibration,
  type CalibrationTask,
  type ChannelScore,
  type DirectionCue,
  type InputSignal,
  type MetricComparison,
  type VisionStatus,
} from '../../packages/adaptive-input/src/index.ts';

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

const TRIGGER_SOURCES = [
  InputSourceId.TOUCH_BUTTON,
  InputSourceId.HAND_CLOSED_FIST,
  InputSourceId.HAND_OPEN_PALM,
  InputSourceId.HAND_THUMB_UP,
] as const;
const DIRECTION_SOURCES = [
  InputSourceId.TOUCH_DIRECTION,
  InputSourceId.HAND_POINT_DIRECTION,
] as const;
const VISION_SOURCES = new Set<InputSourceId>([
  InputSourceId.HAND_CLOSED_FIST,
  InputSourceId.HAND_OPEN_PALM,
  InputSourceId.HAND_THUMB_UP,
  InputSourceId.HAND_POINT_DIRECTION,
]);

type TestMode = keyof typeof TEST_CONFIGS;
type SupportedTask = Extract<CalibrationTask, 'TRIGGER' | 'DIRECTION'>;

interface CalibrationSelection {
  readonly action: string;
  readonly task: SupportedTask;
  readonly currentSource: InputSourceId;
  readonly alternativeSource: InputSourceId;
}

const DEFAULT_SELECTION: CalibrationSelection = {
  action: 'DEMO_TRIGGER',
  task: 'TRIGGER',
  currentSource: InputSourceId.TOUCH_BUTTON,
  alternativeSource: InputSourceId.HAND_CLOSED_FIST,
};

export default function CalibrationClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const visionRef = useRef<VisionInputChannel | null>(null);
  const harnessRef = useRef(new CalibrationHarness());
  const directionHarnessRef = useRef(new DirectionCalibrationHarness());
  const triggerSourcesRef = useRef(createTriggerSources());
  const directionSourcesRef = useRef(createDirectionSources());
  const profileRef = useRef(new CalibrationProfile());
  const storeRef = useRef<CalibrationProfileStore | null>(null);
  const runTokenRef = useRef(0);
  const activeTestRef = useRef<InputSourceId | null>(null);

  const [selection, setSelection] = useState<CalibrationSelection>(DEFAULT_SELECTION);
  const [visionStatus, setVisionStatus] = useState<VisionStatus>('IDLE');
  const [visionDetail, setVisionDetail] = useState(
    'Camera access is required to test camera-based controls. Video processing stays on this device.',
  );
  const [detectedSource, setDetectedSource] = useState<InputSourceId | null>(null);
  const [detectorState, setDetectorState] = useState('READY');
  const [detectorConfidence, setDetectorConfidence] = useState(0);
  const [direction, setDirection] = useState<{ x: number; y: number } | null>(null);
  const [activeTest, setActiveTest] = useState<InputSourceId | null>(null);
  const [testMode, setTestMode] = useState<TestMode>('quick');
  const [cue, setCue] = useState('Choose an input to test');
  const [progress, setProgress] = useState('0 / 6');
  const [testDetail, setTestDetail] = useState(
    'Saved results are reused. Run only the input whose result is missing or needs retesting.',
  );
  const [scores, setScores] = useState<readonly ChannelScore[]>([]);
  const [returnHref, setReturnHref] = useState('/');
  const [skipHref, setSkipHref] = useState('/?calibration=skipped');

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const nextReturnHref = safeReturnPath(search.get('return'), window.location.origin);
    setReturnHref(nextReturnHref);
    setSkipHref(withCalibrationStatus(nextReturnHref, 'skipped', window.location.origin));
    setSelection(parseSelection(search));

    storeRef.current = new CalibrationProfileStore(window.localStorage);
    profileRef.current = storeRef.current.load();
    setScores(profileRef.current.all());

    const handleTouchAttempt = (event: PointerEvent): void => {
      if (activeTestRef.current !== InputSourceId.TOUCH_BUTTON) return;
      const target = event.target;
      if (target instanceof Element && target.closest('[data-calibration-control]')) return;
      triggerSourcesRef.current.get(InputSourceId.TOUCH_BUTTON)?.accept({
        kind: 'trigger',
        source: InputSourceId.TOUCH_BUTTON,
        timestamp: performance.now(),
      });
    };
    window.addEventListener('pointerdown', handleTouchAttempt, true);

    const video = videoRef.current;
    if (video) {
      visionRef.current = new VisionInputChannel(video, {
        onStatus(status, detail) {
          setVisionStatus(status);
          setVisionDetail(detail);
        },
        onDiagnostic(diagnostic) {
          setDetectedSource(diagnostic.detectedCommand);
          setDetectorState(diagnostic.commandState);
          setDetectorConfidence(diagnostic.commandConfidence);
          setDirection(diagnostic.direction);
        },
      });
    }

    return () => {
      window.removeEventListener('pointerdown', handleTouchAttempt, true);
      activeTestRef.current = null;
      runTokenRef.current += 1;
      harnessRef.current.abort();
      directionHarnessRef.current.abort();
      visionRef.current?.stop();
      visionRef.current = null;
    };
  }, []);

  const currentScore = findScore(scores, selection.currentSource, selection.task);
  const alternativeScore = findScore(scores, selection.alternativeSource, selection.task);
  const comparison = currentScore && alternativeScore
    ? compareChannelScores(currentScore, alternativeScore, {
        task: selection.task,
        spatial: false,
        latencyCritical: selection.task === 'DIRECTION',
      })
    : null;
  const recommendation = useMemo(() => {
    const profile = new CalibrationProfile(scores);
    return new ControlRecommender().recommend(
      {
        action: selection.action,
        requirements: {
          task: selection.task,
          spatial: false,
          latencyCritical: selection.task === 'DIRECTION',
        },
        currentSource: selection.currentSource,
        alternativeSource: selection.alternativeSource,
      },
      profile,
    );
  }, [scores, selection]);
  const cameraNeeded = isVisionSource(selection.currentSource) ||
    isVisionSource(selection.alternativeSource);

  const startCamera = async (): Promise<void> => {
    try {
      await visionRef.current?.start({
        emit(signal: InputSignal) {
          triggerSourcesRef.current.forEach((source) => source.accept(signal));
          directionSourcesRef.current.forEach((source) => source.accept(signal));
          if (signal.kind === 'direction') setDirection(signal.direction);
          if (signal.kind === 'direction-end') setDirection(null);
        },
      });
    } catch (error: unknown) {
      setVisionStatus('ERROR');
      setVisionDetail(
        error instanceof Error
          ? error.message
          : 'Vision input is unavailable. Touch controls remain usable.',
      );
    }
  };

  const stopTest = (): void => {
    endTouchDirection();
    activeTestRef.current = null;
    visionRef.current?.focusTriggerSource(null);
    runTokenRef.current += 1;
    harnessRef.current.abort();
    directionHarnessRef.current.abort();
    setActiveTest(null);
    setCue('Stopped');
    setTestDetail('No partial score was saved.');
  };

  const chooseMode = (mode: TestMode): void => {
    if (activeTestRef.current !== null) return;
    setTestMode(mode);
    setProgress(`0 / ${TEST_CONFIGS[mode].trialCount}`);
    setTestDetail(
      mode === 'quick'
        ? 'Quick test uses six prompts and produces an estimate.'
        : 'Full test uses twelve prompts for a stronger comparison.',
    );
  };

  const calibrateSource = async (sourceId: InputSourceId): Promise<void> => {
    if (isVisionSource(sourceId) && visionStatus !== 'READY') {
      setTestDetail(`Enable the camera and wait for Ready before testing ${sourceLabel(sourceId)}.`);
      return;
    }
    if (selection.task === 'TRIGGER') {
      await calibrateTrigger(sourceId);
    } else {
      await calibrateDirection(sourceId);
    }
  };

  const calibrateTrigger = async (sourceId: InputSourceId): Promise<void> => {
    const source = triggerSourcesRef.current.get(sourceId);
    if (!source) {
      setTestDetail(`${sourceLabel(sourceId)} does not provide trigger input.`);
      return;
    }

    const config = TEST_CONFIGS[testMode];
    const token = ++runTokenRef.current;
    harnessRef.current.abort();
    directionHarnessRef.current.abort();
    visionRef.current?.focusTriggerSource(isVisionSource(sourceId) ? sourceId : null);
    activeTestRef.current = sourceId;
    setActiveTest(sourceId);
    setProgress(`0 / ${config.trialCount}`);
    setTestDetail(triggerInstruction(sourceId));
    const session = await harnessRef.current.run(
      {
        sessionId: `${sourceId}-${Date.now()}`,
        task: 'TRIGGER',
        action: selection.action,
        source,
      },
      {
        onWaiting(trialIndex) {
          setCue('WAIT...');
          setProgress(`${trialIndex} / ${config.trialCount}`);
        },
        onCue() {
          setCue(triggerCue(sourceId));
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
    visionRef.current?.focusTriggerSource(null);
    activeTestRef.current = null;
    setActiveTest(null);
    if (session.trials.length !== config.trialCount) {
      setCue('Incomplete');
      setTestDetail('No partial score was saved.');
      return;
    }
    saveScore(scoreCalibration(session));
    setCue('Saved');
    setTestDetail(`${sourceLabel(sourceId)} result saved independently on this device.`);
  };

  const calibrateDirection = async (sourceId: InputSourceId): Promise<void> => {
    const source = directionSourcesRef.current.get(sourceId);
    if (!source) {
      setTestDetail(`${sourceLabel(sourceId)} does not provide directional input.`);
      return;
    }

    const trialCount = 8;
    const token = ++runTokenRef.current;
    harnessRef.current.abort();
    directionHarnessRef.current.abort();
    visionRef.current?.focusTriggerSource(null);
    activeTestRef.current = sourceId;
    setActiveTest(sourceId);
    setProgress(`0 / ${trialCount}`);
    setTestDetail(directionInstruction(sourceId));
    const session = await directionHarnessRef.current.run(
      {
        sessionId: `${sourceId}-${Date.now()}`,
        action: selection.action,
        source,
      },
      {
        onCue(index, target) {
          setCue(directionCueLabel(target, sourceId));
          setProgress(`${index} / ${trialCount}`);
        },
        onTrial(trial) {
          setProgress(`${trial.trialIndex + 1} / ${trialCount}`);
          setCue(
            trial.outcome === 'success'
              ? `${Math.round(trial.latencyMs ?? 0)} ms`
              : 'MISSED',
          );
        },
      },
      { trialCount },
    );

    endTouchDirection();
    if (token !== runTokenRef.current) return;
    activeTestRef.current = null;
    setActiveTest(null);
    if (session.trials.length !== trialCount) {
      setCue('Incomplete');
      setTestDetail('No partial score was saved.');
      return;
    }
    saveScore(scoreDirectionCalibration(session));
    setCue('Saved');
    setTestDetail(
      `${sourceLabel(sourceId)} latency, angular error, jitter and dropouts were saved independently.`,
    );
  };

  const saveScore = (score: ChannelScore): void => {
    profileRef.current.save(score);
    storeRef.current?.save(profileRef.current);
    setScores(profileRef.current.all());
  };

  const clearScores = (): void => {
    profileRef.current = new CalibrationProfile();
    storeRef.current?.clear();
    setScores([]);
    setCue('Results cleared');
  };

  const emitTouchDirection = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (activeTestRef.current !== InputSourceId.TOUCH_DIRECTION) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    const magnitude = Math.hypot(x, y);
    if (magnitude < 8) return;
    const next = { x: x / magnitude, y: y / magnitude };
    directionSourcesRef.current.get(InputSourceId.TOUCH_DIRECTION)?.accept({
      kind: 'direction',
      source: InputSourceId.TOUCH_DIRECTION,
      timestamp: performance.now(),
      direction: next,
    });
    setDirection(next);
  };

  const endTouchDirection = (): void => {
    if (activeTestRef.current !== InputSourceId.TOUCH_DIRECTION) return;
    directionSourcesRef.current.get(InputSourceId.TOUCH_DIRECTION)?.accept({
      kind: 'direction-end',
      source: InputSourceId.TOUCH_DIRECTION,
      timestamp: performance.now(),
    });
    setDirection(null);
  };

  return (
    <main className="calibration-lab">
      <header className="lab-header">
        <a href={returnHref} data-calibration-control>← Back to controls</a>
        <span>CONTROL SETUP</span>
        <h1>Input Performance Test</h1>
        <p>
          The active input and proposed alternative are measured independently. Existing results
          are reused; choosing an alternative here does not activate or bind it.
        </p>
      </header>

      <section className="source-cards" aria-label="Inputs being compared">
        <SourceCard
          role="Current input"
          source={selection.currentSource}
          score={currentScore}
          active={activeTest === selection.currentSource}
          onTest={() => void calibrateSource(selection.currentSource)}
        />
        <SourceCard
          role="Proposed alternative"
          source={selection.alternativeSource}
          score={alternativeScore}
          active={activeTest === selection.alternativeSource}
          onTest={() => void calibrateSource(selection.alternativeSource)}
        />
      </section>

      <section className={`lab-grid ${cameraNeeded ? '' : 'single-column'}`}>
        {cameraNeeded && (
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
              <span>Detected input</span>
              <strong>{direction ? 'Point direction' : detectedSource ? sourceLabel(detectedSource) : 'Neutral'}</strong>
            </div>
            <div className="reading-row">
              <span>Detector state</span>
              <strong>{detectorState}</strong>
            </div>
            <div className="confidence-track">
              <i style={{ width: `${Math.round(detectorConfidence * 100)}%` }} />
            </div>
            <DirectionDiagnostic direction={direction} />
            <div className="button-row">
              <button data-calibration-control onClick={() => void startCamera()}>Enable camera</button>
              <button data-calibration-control onClick={() => visionRef.current?.stop()}>Stop camera</button>
            </div>
          </article>
        )}

        <article className="lab-panel test-panel">
          <div className="panel-title">
            <h2>{selection.task === 'TRIGGER' ? 'Activation test' : 'Direction test'}</h2>
            <span>{progress}</span>
          </div>
          {selection.task === 'TRIGGER' && (
            <>
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
              {testMode === 'quick' && (
                <p>
                  Quick Test is a preview only. Saving it replaces the previous result, including
                  a Full Test.
                </p>
              )}
            </>
          )}
          <div className={`test-cue ${activeTest ? 'active' : ''}`}>{cue}</div>
          <p>{testDetail}</p>
          {selection.task === 'TRIGGER' && activeTest === InputSourceId.TOUCH_BUTTON && (
            <button className="touch-action">Touch action</button>
          )}
          {selection.task === 'DIRECTION' && activeTest === InputSourceId.TOUCH_DIRECTION && (
            <div
              className="direction-pad"
              onPointerDown={emitTouchDirection}
              onPointerMove={emitTouchDirection}
              onPointerUp={endTouchDirection}
              onPointerCancel={endTouchDirection}
              role="application"
              aria-label="Touch direction calibration pad"
            >
              <span>Touch, drag and hold toward the cue</span>
              <i />
            </div>
          )}
          <div className="button-row test-actions">
            <button data-calibration-control onClick={stopTest}>Stop test</button>
            <a className="skip-calibration" href={skipHref} data-calibration-control>
              Skip calibration for testing
            </a>
          </div>
          <small className="skip-note">
            Skipping saves no score and never marks either input as calibrated.
          </small>
        </article>
      </section>

      {selection.task === 'DIRECTION' && (
        <section className="direction-result-grid">
          <DirectionResult label={sourceLabel(selection.currentSource)} score={currentScore} />
          <DirectionResult label={sourceLabel(selection.alternativeSource)} score={alternativeScore} />
        </section>
      )}

      <section className="lab-panel comparison-panel">
        <div className="panel-title">
          <h2>Results</h2>
          <button data-calibration-control onClick={clearScores}>Clear saved results</button>
        </div>
        <ComparisonTable
          currentLabel={sourceLabel(selection.currentSource)}
          alternativeLabel={sourceLabel(selection.alternativeSource)}
          current={currentScore}
          alternative={alternativeScore}
          comparison={comparison}
        />
        <div className={`recommendation ${recommendation.verdict}`}>
          <span>{verdictLabel(recommendation.verdict)}</span>
          <strong>{recommendation.explanation}</strong>
          <small>Your controls have not been changed. You keep the final choice.</small>
        </div>
        {currentScore && alternativeScore && (
          <a className="review-binding" href={returnHref} data-calibration-control>
            Review binding decision
          </a>
        )}
      </section>
    </main>
  );
}

function createTriggerSources(): Map<InputSourceId, TriggerCalibrationSource> {
  return new Map(
    TRIGGER_SOURCES.map((source) => [source, new TriggerCalibrationSource(source)] as const),
  );
}

function createDirectionSources(): Map<InputSourceId, DirectionSignalSource> {
  return new Map(
    DIRECTION_SOURCES.map((source) => [source, new DirectionSignalSource(source)] as const),
  );
}

function parseSelection(search: URLSearchParams): CalibrationSelection {
  const task = search.get('task');
  const currentSource = parseSource(search.get('current'));
  const alternativeSource = parseSource(search.get('alternative'));
  const supportedTask = task === 'TRIGGER' || task === 'DIRECTION' ? task : null;
  if (
    !supportedTask ||
    !currentSource ||
    !alternativeSource ||
    currentSource === alternativeSource ||
    !supportsTask(currentSource, supportedTask) ||
    !supportsTask(alternativeSource, supportedTask)
  ) {
    return DEFAULT_SELECTION;
  }
  return {
    action: search.get('action') || DEFAULT_SELECTION.action,
    task: supportedTask,
    currentSource,
    alternativeSource,
  };
}

function supportsTask(source: InputSourceId, task: SupportedTask): boolean {
  return task === 'TRIGGER'
    ? (TRIGGER_SOURCES as readonly InputSourceId[]).includes(source)
    : (DIRECTION_SOURCES as readonly InputSourceId[]).includes(source);
}

function parseSource(value: string | null): InputSourceId | null {
  if (!value) return null;
  return Object.values(InputSourceId).find((source) => source === value) ?? null;
}

function isVisionSource(source: InputSourceId): boolean {
  return VISION_SOURCES.has(source);
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

function withCalibrationStatus(path: string, status: string, origin: string): string {
  const parsed = new URL(path, origin);
  parsed.searchParams.set('calibration', status);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function findScore(
  scores: readonly ChannelScore[],
  source: InputSourceId,
  task: ChannelScore['task'],
): ChannelScore | undefined {
  return scores.find((score) => score.task === task && score.source === source);
}

function sourceLabel(source: InputSourceId): string {
  const labels: Partial<Record<InputSourceId, string>> = {
    [InputSourceId.TOUCH_BUTTON]: 'Touch button',
    [InputSourceId.TOUCH_DIRECTION]: 'Touch direction',
    [InputSourceId.HAND_CLOSED_FIST]: 'Closed fist',
    [InputSourceId.HAND_OPEN_PALM]: 'Open palm',
    [InputSourceId.HAND_THUMB_UP]: 'Thumbs up',
    [InputSourceId.HAND_POINT_DIRECTION]: 'Point direction',
  };
  return labels[source] ?? source;
}

function triggerInstruction(source: InputSourceId): string {
  switch (source) {
    case InputSourceId.TOUCH_BUTTON:
      return 'During WAIT, do not touch. Press Touch action only when TAP NOW appears.';
    case InputSourceId.HAND_CLOSED_FIST:
      return 'During WAIT, relax your hand. Make one closed fist only when prompted.';
    case InputSourceId.HAND_OPEN_PALM:
      return 'During WAIT, keep your hand out of the pose. Show one open palm only when prompted.';
    case InputSourceId.HAND_THUMB_UP:
      return 'During WAIT, keep a neutral hand. Show one thumbs-up only when prompted.';
    default:
      return 'Respond once when the cue appears.';
  }
}

function triggerCue(source: InputSourceId): string {
  switch (source) {
    case InputSourceId.TOUCH_BUTTON:
      return 'TAP NOW';
    case InputSourceId.HAND_CLOSED_FIST:
      return 'MAKE A FIST';
    case InputSourceId.HAND_OPEN_PALM:
      return 'SHOW OPEN PALM';
    case InputSourceId.HAND_THUMB_UP:
      return 'THUMBS UP';
    default:
      return 'ACTIVATE NOW';
  }
}

function directionInstruction(source: InputSourceId): string {
  return source === InputSourceId.TOUCH_DIRECTION
    ? 'Touch the pad, drag toward the shown direction and hold briefly.'
    : 'Point in the shown direction and hold steadily. Left must produce a negative x value.';
}

function directionCueLabel(cue: DirectionCue, source: InputSourceId): string {
  const verb = source === InputSourceId.TOUCH_DIRECTION ? 'MOVE' : 'POINT';
  const arrow = { up: '↑', down: '↓', left: '←', right: '→' }[cue];
  return `${arrow} ${verb} ${cue.toUpperCase()}`;
}

function SourceCard({
  role,
  source,
  score,
  active,
  onTest,
}: {
  role: string;
  source: InputSourceId;
  score?: ChannelScore;
  active: boolean;
  onTest: () => void;
}) {
  return (
    <article className={`source-card ${active ? 'active' : ''}`}>
      <span>{role}</span>
      <strong>{sourceLabel(source)}</strong>
      <small>{score ? `${evidenceLabel(score)} saved on this device` : 'Calibration required'}</small>
      <button data-calibration-control disabled={active} onClick={onTest}>
        {score ? `Retest ${sourceLabel(source)}` : `Test ${sourceLabel(source)}`}
      </button>
    </article>
  );
}

function DirectionDiagnostic({ direction }: { direction: { x: number; y: number } | null }) {
  return (
    <div className="direction-diagnostic" aria-live="polite">
      <span
        className={`direction-arrow ${direction ? 'active' : ''}`}
        style={{
          transform: `rotate(${direction ? Math.atan2(direction.y, direction.x) * 180 / Math.PI : 0}deg)`,
        }}
      >
        ➜
      </span>
      <code>
        {direction
          ? `{ x: ${direction.x.toFixed(2)}, y: ${direction.y.toFixed(2)} }`
          : '{ x: —, y: — }'}
      </code>
    </div>
  );
}

function DirectionResult({ label, score }: { label: string; score?: ChannelScore }) {
  const metrics = score?.directionMetrics;
  return (
    <section className="lab-panel direction-results">
      <div className="panel-title">
        <h2>{label}</h2>
        <span>{score ? `${Math.round(score.successRate * 100)}% success` : 'Not calibrated'}</span>
      </div>
      <div className="direction-metrics">
        <span>Median latency <strong>{formatLatency(score)}</strong></span>
        <span>Angular error <strong>{metrics ? `${metrics.meanAngularErrorDeg.toFixed(1)}°` : '—'}</strong></span>
        <span>Jitter <strong>{metrics ? `${metrics.meanJitterDeg.toFixed(1)}°` : '—'}</strong></span>
        <span>Dropouts <strong>{metrics?.dropoutCount ?? '—'}</strong></span>
      </div>
    </section>
  );
}

function ComparisonTable({
  currentLabel,
  alternativeLabel,
  current,
  alternative,
  comparison,
}: {
  currentLabel: string;
  alternativeLabel: string;
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
            <th>{currentLabel} · current</th>
            <th>{alternativeLabel} · proposed</th>
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
          {(current?.task === 'DIRECTION' || alternative?.task === 'DIRECTION') && (
            <>
              <tr>
                <th>Direction error <small>angular error; lower is better</small></th>
                <MetricCell
                  value={formatDirectionMetric(current, 'meanAngularErrorDeg')}
                  status={sideStatus(comparison?.angularError, 'current')}
                />
                <MetricCell
                  value={formatDirectionMetric(alternative, 'meanAngularErrorDeg')}
                  status={sideStatus(comparison?.angularError, 'alternative')}
                />
              </tr>
              <tr>
                <th>Direction wobble <small>jitter; lower is better</small></th>
                <MetricCell
                  value={formatDirectionMetric(current, 'meanJitterDeg')}
                  status={sideStatus(comparison?.jitter, 'current')}
                />
                <MetricCell
                  value={formatDirectionMetric(alternative, 'meanJitterDeg')}
                  status={sideStatus(comparison?.jitter, 'alternative')}
                />
              </tr>
              <tr>
                <th>Direction dropouts <small>lower is better</small></th>
                <MetricCell
                  value={formatDirectionMetric(current, 'dropoutCount')}
                  status={sideStatus(comparison?.dropouts, 'current')}
                />
                <MetricCell
                  value={formatDirectionMetric(alternative, 'dropoutCount')}
                  status={sideStatus(comparison?.dropouts, 'alternative')}
                />
              </tr>
            </>
          )}
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
  if (!score || score.medianLatencyMs === null) return '—';
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

function formatDirectionMetric(
  score: ChannelScore | undefined,
  metric: 'meanAngularErrorDeg' | 'meanJitterDeg' | 'dropoutCount',
): string {
  const value = score?.directionMetrics?.[metric];
  if (value === undefined) return '—';
  return metric === 'dropoutCount' ? String(value) : `${value.toFixed(1)}°`;
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1_000).toFixed(1)} sec WAIT`;
}

function evidenceLabel(score?: ChannelScore): string | undefined {
  if (!score) return undefined;
  if (score.task === 'DIRECTION') return `${score.trialCount}-direction test`;
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
