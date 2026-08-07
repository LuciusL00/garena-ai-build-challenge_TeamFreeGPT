/** Executable acceptance check for the portable input spine. */

import {
  AdaptiveInput,
  BindingSettingsController,
  CalibrationProfile,
  CalibrationProfileStore,
  ChannelManager,
  ControlRecommender,
  DEFAULT_GESTURE_COMMAND_CONFIG,
  GestureCommandGate,
  InputChannelId,
  InputSourceId,
  PointDirectionTracker,
  RAPID_GESTURE_STABILITY_STEPS_MS,
  RapidGestureTuner,
  VisionDeviceSettings,
  VisionInputChannel,
  compareChannelScores,
  VisionTuningStore,
  DEFAULT_POINT_STABILITY_MS,
  highestConfidenceGestureCommand,
  recommendPointStabilityMs,
  recommendVisionInferenceFps,
  scoreCalibration,
} from '../index.ts';
import type {
  CalibrationSession,
  ChannelScore,
  ChannelContext,
  InputChannel,
  ProfileStorage,
  VisionDeviceTarget,
  VisionFrameRateProbeResult,
  VisionInferenceFps,
} from '../index.ts';

type EmptyPayload = Record<string, never>;

interface TestActions {
  BEGIN_ROUND: EmptyPayload;
  RESTART_ROUND: EmptyPayload;
  TOGGLE_SQUAD: EmptyPayload;
  DIRECT_UNITS: { direction: { x: number; y: number } | null };
}

const failures: string[] = [];

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures.push(label);
  }
}

function checkThrows(label: string, operation: () => void): void {
  try {
    operation();
    check(label, false);
  } catch (error: unknown) {
    check(label, error instanceof Error);
  }
}

class FakeChannel implements InputChannel {
  readonly sources: readonly InputSourceId[];
  startCount = 0;
  stopCount = 0;
  private active = false;

  constructor(
    readonly id: InputChannelId,
    sources: readonly InputSourceId[],
  ) {
    this.sources = sources;
  }

  get isActive(): boolean {
    return this.active;
  }

  async start(_context: ChannelContext): Promise<void> {
    this.startCount += 1;
    this.active = true;
  }

  stop(): void {
    if (!this.active) return;
    this.stopCount += 1;
    this.active = false;
  }
}

/** Stands in for a running camera so the device setting can be checked offline. */
class FakeVisionDevice implements VisionDeviceTarget {
  isActive = true;
  requestedInferenceFps: VisionInferenceFps = 15;

  setInferenceFps(fps: VisionInferenceFps): void {
    this.requestedInferenceFps = fps;
  }

  measureInferenceFps(): Promise<readonly VisionFrameRateProbeResult[]> {
    return Promise.resolve([
      { requestedFps: 10, effectiveFps: 9.8, medianInferenceDurationMs: 20, sampleCount: 10 },
      { requestedFps: 12, effectiveFps: 11.7, medianInferenceDurationMs: 24, sampleCount: 12 },
      { requestedFps: 15, effectiveFps: 11.5, medianInferenceDurationMs: 25, sampleCount: 15 },
    ]);
  }
}

class MemoryProfileStorage implements ProfileStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

async function main(): Promise<void> {
  const adaptive = new AdaptiveInput<TestActions>();
  adaptive.registerActions([
    {
      id: 'BEGIN_ROUND',
      requirements: { task: 'TRIGGER', spatial: false, latencyCritical: false },
      defaultSource: InputSourceId.TOUCH_BUTTON,
      remappable: false,
    },
    {
      id: 'RESTART_ROUND',
      requirements: { task: 'TRIGGER', spatial: false, latencyCritical: false },
      defaultSource: InputSourceId.TOUCH_BUTTON,
      remappable: false,
    },
    {
      id: 'TOGGLE_SQUAD',
      requirements: { task: 'TRIGGER', spatial: false, latencyCritical: false },
      defaultSource: InputSourceId.TOUCH_BUTTON,
      remappable: true,
    },
    {
      id: 'DIRECT_UNITS',
      requirements: { task: 'DIRECTION', spatial: false, latencyCritical: true },
      defaultSource: InputSourceId.TOUCH_DIRECTION,
      remappable: false,
    },
  ]);

  console.log('\nOriginal controls');
  check(
    'one touch-button source backs several actions',
    adaptive.bindings.get('BEGIN_ROUND') === InputSourceId.TOUCH_BUTTON &&
      adaptive.bindings.get('RESTART_ROUND') === InputSourceId.TOUCH_BUTTON &&
      adaptive.bindings.get('TOGGLE_SQUAD') === InputSourceId.TOUCH_BUTTON,
  );
  check(
    'direction action keeps its touch fallback',
    adaptive.bindings.get('DIRECT_UNITS') === InputSourceId.TOUCH_DIRECTION,
  );
  checkThrows('fixed Begin control cannot be rebound', () => {
    adaptive.rebind('BEGIN_ROUND', InputSourceId.HAND_CLOSED_FIST);
  });

  let received = 0;
  adaptive.on('TOGGLE_SQUAD', () => {
    received += 1;
  });

  console.log('\nBinding gate and pre-gate telemetry');
  adaptive.emitFrom('TOGGLE_SQUAD', {}, {
    source: InputSourceId.TOUCH_BUTTON,
    kind: 'trigger',
    timestamp: 100,
    sessionId: 'baseline-1',
    phase: 'baseline',
  });
  adaptive.emitFrom('TOGGLE_SQUAD', {}, {
    source: InputSourceId.HAND_CLOSED_FIST,
    kind: 'trigger',
    timestamp: 110,
    confidence: 0.92,
    sessionId: 'baseline-1',
    phase: 'baseline',
  });
  check('only the default touch source dispatches', received === 1);
  check('accepted and rejected attempts are both recorded', adaptive.telemetry.all().length === 2);
  check('rejected gesture attempt is retained', adaptive.telemetry.rejected().length === 1);
  check('session and phase metadata are retained', adaptive.telemetry.forSession('baseline-1').length === 2);

  adaptive.rebind('TOGGLE_SQUAD', InputSourceId.HAND_CLOSED_FIST);
  adaptive.emitFrom('TOGGLE_SQUAD', {}, {
    source: InputSourceId.HAND_CLOSED_FIST,
    kind: 'trigger',
    timestamp: 200,
    confidence: 0.94,
    phase: 'validation',
  });
  adaptive.emitFrom('TOGGLE_SQUAD', {}, {
    source: InputSourceId.TOUCH_BUTTON,
    kind: 'trigger',
    timestamp: 210,
    phase: 'validation',
  });
  check('gesture dispatches after rebind', received === 2);
  check('old touch attempt is rejected after rebind', adaptive.telemetry.rejected().length === 2);

  console.log('\nChannel lifecycle');
  const touch = new FakeChannel(InputChannelId.TOUCH, [
    InputSourceId.TOUCH_BUTTON,
    InputSourceId.TOUCH_POINTER,
  ]);
  const hand = new FakeChannel(InputChannelId.HAND_VISION, [
    InputSourceId.HAND_CLOSED_FIST,
  ]);
  const manager = new ChannelManager({ emit: () => undefined });
  manager.register(touch);
  manager.register(hand);

  let channelFailures = await manager.reconcile(adaptive.bindings.activeChannels());
  check('required touch and hand channels start', touch.isActive && hand.isActive);
  check('channel startup succeeds', channelFailures.length === 0);

  channelFailures = await manager.reconcile(adaptive.bindings.activeChannels());
  check('reconcile does not start active channels twice', touch.startCount === 1 && hand.startCount === 1);

  adaptive.rebind('TOGGLE_SQUAD', InputSourceId.TOUCH_BUTTON);
  await manager.reconcile(adaptive.bindings.activeChannels());
  check('unused vision channel stops after rebind', !hand.isActive && hand.stopCount === 1);
  check('original touch channel remains active', touch.isActive);
  await manager.stopAll();

  console.log('\nCalibration score and profile memory');
  const touchSession: CalibrationSession<'TOGGLE_SQUAD'> = {
    id: 'touch-trigger',
    task: 'TRIGGER',
    channelUnderTest: InputChannelId.TOUCH,
    sourceUnderTest: InputSourceId.TOUCH_BUTTON,
    action: 'TOGGLE_SQUAD',
    startedAt: 1_000,
    trials: [
      {
        trialIndex: 0,
        action: 'TOGGLE_SQUAD',
        waitingStartedAt: -6_500,
        cueAt: 1_000,
        respondedAt: 1_200,
        latencyMs: 200,
        source: InputSourceId.TOUCH_BUTTON,
        outcome: 'success',
      },
      {
        trialIndex: 1,
        action: 'TOGGLE_SQUAD',
        waitingStartedAt: -5_500,
        cueAt: 2_000,
        respondedAt: 2_400,
        latencyMs: 400,
        source: InputSourceId.TOUCH_BUTTON,
        outcome: 'success',
      },
      {
        trialIndex: 2,
        action: 'TOGGLE_SQUAD',
        waitingStartedAt: -4_500,
        cueAt: 3_000,
        respondedAt: null,
        latencyMs: null,
        source: null,
        outcome: 'miss',
      },
      {
        trialIndex: 3,
        action: 'TOGGLE_SQUAD',
        waitingStartedAt: -3_500,
        cueAt: 4_000,
        respondedAt: null,
        latencyMs: null,
        source: null,
        outcome: 'miss',
      },
    ],
    falseActivations: [
      {
        action: 'TOGGLE_SQUAD',
        source: InputSourceId.TOUCH_BUTTON,
        timestamp: 500,
        context: 'waiting',
      },
    ],
  };
  const fistSession: CalibrationSession<'TOGGLE_SQUAD'> = {
    ...touchSession,
    id: 'fist-trigger',
    channelUnderTest: InputChannelId.HAND_VISION,
    sourceUnderTest: InputSourceId.HAND_CLOSED_FIST,
    trials: [600, 620, 640, 660].map((latencyMs, trialIndex) => ({
      trialIndex,
      action: 'TOGGLE_SQUAD' as const,
      waitingStartedAt: 2_500 + trialIndex * 1_000,
      cueAt: 10_000 + trialIndex * 1_000,
      respondedAt: 10_000 + trialIndex * 1_000 + latencyMs,
      latencyMs,
      source: InputSourceId.HAND_CLOSED_FIST,
      confidence: 0.95,
      outcome: 'success' as const,
    })),
    falseActivations: [],
  };
  const touchScore = scoreCalibration(touchSession, 50_000);
  const fistScore = scoreCalibration(fistSession, 50_100);
  check('existing summary becomes a reusable success score', touchScore.successRate === 0.5);
  check('even-sized latency list uses the standard median', touchScore.medianLatencyMs === 300);
  check('WAIT activation is retained in the score', touchScore.falseActivationCount === 1);
  check('WAIT duration becomes the false-activation denominator', touchScore.falseActivationObservationMs === 30_000);
  check('WAIT count becomes a per-minute estimate', touchScore.falseActivationsPerMinute === 2);

  const profile = new CalibrationProfile([touchScore, fistScore]);
  check(
    'trigger touch score is remembered by task and source',
    profile.get('TRIGGER', InputSourceId.TOUCH_BUTTON)?.successRate === 0.5,
  );
  check(
    'trigger score is not reused as a direction score',
    profile.get('DIRECTION', InputSourceId.TOUCH_BUTTON) === undefined,
  );
  const profileStorage = new CalibrationProfileStore(new MemoryProfileStorage());
  profileStorage.save(profile);
  const restoredProfile = profileStorage.load();
  check(
    'profile scores survive save and load',
    restoredProfile.get('TRIGGER', InputSourceId.HAND_CLOSED_FIST)?.successRate === 1,
  );
  const tuningStorage = new VisionTuningStore(new MemoryProfileStorage());
  tuningStorage.save({
    inferenceFps: 12,
    gestureStabilityMs: {
      [InputSourceId.HAND_CLOSED_FIST]: 160,
      [InputSourceId.HAND_OPEN_PALM]: 240,
    },
    pointStabilityMs: 240,
  });
  const restoredTuning = tuningStorage.load();
  check('device frame-rate choice survives save and load', restoredTuning.inferenceFps === 12);
  check(
    'gesture hold time is remembered separately for each pose',
    restoredTuning.gestureStabilityMs[InputSourceId.HAND_CLOSED_FIST] === 160 &&
      restoredTuning.gestureStabilityMs[InputSourceId.HAND_OPEN_PALM] === 240 &&
      restoredTuning.gestureStabilityMs[InputSourceId.HAND_THUMB_UP] === undefined,
  );
  check(
    'pointing stability is stored apart from the trigger hold times',
    restoredTuning.pointStabilityMs === 240,
  );
  const legacyTuningStorage = new MemoryProfileStorage();
  legacyTuningStorage.setItem(
    'teamfreegpt.adaptive-input.vision-tuning.v1',
    JSON.stringify({ version: 1, inferenceFps: 10, gestureStabilityMs: {} }),
  );
  check(
    'a record saved before pointing stability existed keeps the default',
    new VisionTuningStore(legacyTuningStorage).load().pointStabilityMs === DEFAULT_POINT_STABILITY_MS,
  );
  console.log('\nRule-based recommendation');
  const recommender = new ControlRecommender();
  const request = {
    action: 'TOGGLE_SQUAD' as const,
    requirements: { task: 'TRIGGER' as const, spatial: false, latencyCritical: false },
    currentSource: InputSourceId.TOUCH_BUTTON,
    alternativeSource: InputSourceId.HAND_CLOSED_FIST,
  };
  const clearlyBetterProfile = new CalibrationProfile([
    { ...touchScore, medianLatencyMs: 800 },
    fistScore,
  ]);
  check(
    'alternative dominance recommends the alternative',
    recommender.recommend(request, clearlyBetterProfile).verdict === 'swap',
  );
  const incompleteProfile = new CalibrationProfile([touchScore]);
  check(
    'missing alternative result requests calibration',
    recommender.recommend(request, incompleteProfile).verdict === 'needs-calibration',
  );
  check(
    'faster touch versus more reliable fist stays a visible trade-off',
    recommender.recommend(request, restoredProfile).verdict === 'trade-off',
  );
  const weakerAlternativeProfile = new CalibrationProfile([
    touchScore,
    {
      ...fistScore,
      successCount: 1,
      successRate: 0.25,
      medianLatencyMs: 900,
      falseActivationCount: 2,
      falseActivationsPerMinute: 4,
    },
  ]);
  check(
    'current dominance keeps the original source',
    recommender.recommend(request, weakerAlternativeProfile).verdict === 'keep',
  );
  const similarProfile = new CalibrationProfile([
    touchScore,
    {
      ...touchScore,
      channel: InputChannelId.HAND_VISION,
      source: InputSourceId.HAND_CLOSED_FIST,
    },
  ]);
  check(
    'similar measurements keep the original without inventing a winner',
    recommender.recommend(request, similarProfile).verdict === 'keep',
  );
  const lowSuccessProfile = new CalibrationProfile([
    { ...touchScore, successCount: 1, successRate: 0.25 },
    { ...fistScore, successCount: 1, successRate: 0.25 },
  ]);
  check(
    'two low-success controls request a retest',
    recommender.recommend(request, lowSuccessProfile).verdict === 'retest',
  );
  const latencySensitiveResult = recommender.recommend(
    {
      ...request,
      requirements: { task: 'TRIGGER', spatial: false, latencyCritical: true },
    },
    clearlyBetterProfile,
  );
  check(
    'latency-critical action keeps a measured winner and explains relevant latency',
    latencySensitiveResult.verdict === 'swap' &&
      latencySensitiveResult.explanation.includes('latency-sensitive'),
  );

  const quickCurrent: ChannelScore = {
    ...touchScore,
    trialCount: 6,
    successCount: 5,
    successRate: 5 / 6,
    medianLatencyMs: 500,
    falseActivationCount: 0,
    falseActivationObservationMs: 15_000,
    falseActivationsPerMinute: 0,
  };
  const quickAlternative: ChannelScore = {
    ...fistScore,
    trialCount: 6,
    successCount: 6,
    successRate: 1,
    medianLatencyMs: 500,
    falseActivationCount: 0,
    falseActivationObservationMs: 15_000,
    falseActivationsPerMinute: 0,
  };
  check(
    'one quick-test miss does not invent a winner',
    compareChannelScores(quickCurrent, quickAlternative).success === 'similar' &&
      recommender.recommend(
        request,
        new CalibrationProfile([quickCurrent, quickAlternative]),
      ).verdict === 'keep',
  );
  const twoMissCurrent = {
    ...quickCurrent,
    successCount: 4,
    successRate: 4 / 6,
  };
  check(
    'two quick-test misses are a meaningful success difference',
    compareChannelScores(twoMissCurrent, quickAlternative).success === 'alternative-better',
  );
  const oneFalseActivation = {
    ...quickAlternative,
    falseActivationCount: 1,
    falseActivationsPerMinute: 4,
  };
  check(
    'one accidental activation remains visible without deciding the winner',
    compareChannelScores(quickCurrent, oneFalseActivation).falseActivations === 'similar',
  );
  const repeatedFalseActivations = {
    ...quickAlternative,
    falseActivationCount: 2,
    falseActivationsPerMinute: 8,
  };
  check(
    'repeated accidental activations affect the comparison',
    compareChannelScores(quickCurrent, repeatedFalseActivations).falseActivations === 'current-better',
  );
  check(
    'short WAIT observation does not claim a false-activation advantage',
    compareChannelScores(
      { ...quickCurrent, falseActivationObservationMs: 5_000 },
      { ...repeatedFalseActivations, falseActivationObservationMs: 5_000 },
    ).falseActivations === 'unavailable',
  );

  const touchDirectionScore: ChannelScore = {
    task: 'DIRECTION',
    channel: InputChannelId.TOUCH,
    source: InputSourceId.TOUCH_DIRECTION,
    trialCount: 8,
    successCount: 8,
    successRate: 1,
    medianLatencyMs: 450,
    falseActivationCount: 0,
    falseActivationObservationMs: 0,
    falseActivationsPerMinute: 0,
    directionMetrics: {
      meanAngularErrorDeg: 18,
      meanJitterDeg: 10,
      dropoutCount: 3,
    },
    recordedAt: 60_000,
  };
  const handDirectionScore: ChannelScore = {
    ...touchDirectionScore,
    channel: InputChannelId.HAND_VISION,
    source: InputSourceId.HAND_POINT_DIRECTION,
    directionMetrics: {
      meanAngularErrorDeg: 8,
      meanJitterDeg: 4,
      dropoutCount: 0,
    },
  };
  const directionRequest = {
    action: 'DIRECT_UNITS' as const,
    requirements: { task: 'DIRECTION' as const, spatial: false, latencyCritical: true },
    currentSource: InputSourceId.TOUCH_DIRECTION,
    alternativeSource: InputSourceId.HAND_POINT_DIRECTION,
  };
  check(
    'direction quality can recommend a more precise stable alternative',
    recommender.recommend(
      directionRequest,
      new CalibrationProfile([touchDirectionScore, handDirectionScore]),
    ).verdict === 'swap',
  );
  check(
    'mixed direction quality remains a player-visible trade-off',
    recommender.recommend(
      directionRequest,
      new CalibrationProfile([
        touchDirectionScore,
        {
          ...handDirectionScore,
          directionMetrics: {
            meanAngularErrorDeg: 8,
            meanJitterDeg: 20,
            dropoutCount: 0,
          },
        },
      ]),
    ).verdict === 'trade-off',
  );
  check(
    'spatial actions request missing precision evidence instead of guessing',
    recommender.recommend(
      {
        ...directionRequest,
        requirements: { task: 'DIRECTION', spatial: true, latencyCritical: false },
      },
      new CalibrationProfile([
        { ...touchDirectionScore, directionMetrics: undefined },
        { ...handDirectionScore, directionMetrics: undefined },
      ]),
    ).verdict === 'retest',
  );

  console.log('\nBinding settings controller');
  const settings = new BindingSettingsController(
    adaptive,
    [
      {
        id: 'TOGGLE_SQUAD',
        label: 'Switch squad',
        description: 'Changes the selected squad.',
        context: 'GAMEPLAY',
        requirements: { task: 'TRIGGER', spatial: false, latencyCritical: false },
        defaultSource: InputSourceId.TOUCH_BUTTON,
        remappable: true,
      },
    ],
    [
      {
        id: InputSourceId.TOUCH_BUTTON,
        label: 'Touch button',
        tasks: ['TRIGGER'],
        scope: 'TARGETED',
        requiresCamera: false,
      },
      {
        id: InputSourceId.HAND_CLOSED_FIST,
        label: 'Closed fist',
        tasks: ['TRIGGER'],
        scope: 'GLOBAL',
        requiresCamera: true,
      },
      {
        id: InputSourceId.HAND_POINT_DIRECTION,
        label: 'Point direction',
        tasks: ['DIRECTION'],
        scope: 'GLOBAL',
        requiresCamera: true,
      },
    ],
  );
  check('host action labels are exposed without game imports', settings.actions()[0]?.label === 'Switch squad');
  check(
    'settings filters out inputs with the wrong task shape',
    settings.sourcesFor('TOGGLE_SQUAD').every((source) => source.id !== InputSourceId.HAND_POINT_DIRECTION),
  );
  const bindingBeforePreview = adaptive.bindings.get('TOGGLE_SQUAD');
  const unmeasuredPreview = settings.preview(
    'TOGGLE_SQUAD',
    InputSourceId.HAND_CLOSED_FIST,
    incompleteProfile,
  );
  check('binding remains unavailable until both inputs are measured', !unmeasuredPreview.readyToApply);
  check('preview does not mutate the live binding', adaptive.bindings.get('TOGGLE_SQUAD') === bindingBeforePreview);
  checkThrows('normal confirmation rejects an unmeasured binding', () => settings.confirm(unmeasuredPreview, true));
  settings.confirmWithoutCalibration(unmeasuredPreview, true);
  check('explicit skip applies an uncalibrated binding', adaptive.bindings.get('TOGGLE_SQUAD') === InputSourceId.HAND_CLOSED_FIST);
  adaptive.rebind('TOGGLE_SQUAD', InputSourceId.TOUCH_BUTTON);
  const measuredPreview = settings.preview(
    'TOGGLE_SQUAD',
    InputSourceId.HAND_CLOSED_FIST,
    clearlyBetterProfile,
  );
  check('measured binding is ready for explicit approval', measuredPreview.readyToApply);
  check('preparing a recommendation still keeps the original input', adaptive.bindings.get('TOGGLE_SQUAD') === InputSourceId.TOUCH_BUTTON);
  settings.confirm(measuredPreview);
  check('confirmation applies the alternative input', adaptive.bindings.get('TOGGLE_SQUAD') === InputSourceId.HAND_CLOSED_FIST);
  settings.reset('TOGGLE_SQUAD');
  check('reset restores the host default', adaptive.bindings.get('TOGGLE_SQUAD') === InputSourceId.TOUCH_BUTTON);

  console.log('\nPer-hand gesture command gate');
  const gestureActivations: InputSourceId[] = [];
  const commandGate = new GestureCommandGate((candidate) => gestureActivations.push(candidate.source));
  const selected = highestConfidenceGestureCommand([
    { source: InputSourceId.HAND_CLOSED_FIST, confidence: 0.82 },
    { source: InputSourceId.HAND_OPEN_PALM, confidence: 0.94 },
    { source: InputSourceId.HAND_THUMB_UP, confidence: 0.79 },
  ]);
  check(
    'one highest-confidence command is selected for the processed hand',
    selected?.source === InputSourceId.HAND_OPEN_PALM,
  );

  commandGate.update(0, { source: InputSourceId.HAND_CLOSED_FIST, confidence: 0.9 });
  commandGate.update(100, { source: InputSourceId.HAND_OPEN_PALM, confidence: 0.95 });
  commandGate.update(299, { source: InputSourceId.HAND_OPEN_PALM, confidence: 0.95 });
  check('a pose transition restarts the stability window', gestureActivations.length === 0);
  commandGate.update(300, { source: InputSourceId.HAND_OPEN_PALM, confidence: 0.95 });
  check(
    'only the stable winning pose fires',
    gestureActivations.length === 1 && gestureActivations[0] === InputSourceId.HAND_OPEN_PALM,
  );
  commandGate.update(500, { source: InputSourceId.HAND_THUMB_UP, confidence: 0.95 });
  commandGate.update(699, { source: InputSourceId.HAND_THUMB_UP, confidence: 0.95 });
  check('a different pose does not fire before stability and cooldown', gestureActivations.length === 1);
  commandGate.update(750, { source: InputSourceId.HAND_THUMB_UP, confidence: 0.95 });
  check(
    'a stable different pose fires without pointing or neutral first',
    gestureActivations.length === 2 && gestureActivations[1] === InputSourceId.HAND_THUMB_UP,
  );
  commandGate.update(950, { source: InputSourceId.HAND_THUMB_UP, confidence: 0.95 });
  check('holding the same pose does not repeat its action', gestureActivations.length === 2);
  commandGate.update(1_000, null);
  commandGate.update(1_200, null);
  commandGate.update(1_349, null);
  check('neutral re-arm keeps its configured duration', commandGate.state === 'LOCKED');
  commandGate.update(1_350, null);
  commandGate.update(1_360, { source: InputSourceId.HAND_CLOSED_FIST, confidence: 0.95 });
  commandGate.update(1_560, { source: InputSourceId.HAND_CLOSED_FIST, confidence: 0.95 });
  check(
    'a new command can fire after neutral',
    gestureActivations.length === 3 && gestureActivations[2] === InputSourceId.HAND_CLOSED_FIST,
  );

  const fasterActivations: number[] = [];
  const fasterGate = new GestureCommandGate(
    (_candidate, timestamp) => fasterActivations.push(timestamp),
    { ...DEFAULT_GESTURE_COMMAND_CONFIG, stabilityMs: 120 },
  );
  fasterGate.update(0, { source: InputSourceId.HAND_CLOSED_FIST, confidence: 0.9 });
  fasterGate.update(119, { source: InputSourceId.HAND_CLOSED_FIST, confidence: 0.9 });
  check('120 ms timing does not fire early', fasterActivations.length === 0);
  fasterGate.update(120, { source: InputSourceId.HAND_CLOSED_FIST, confidence: 0.9 });
  check('120 ms timing fires at its explicit boundary', fasterActivations[0] === 120);

  const confidenceActivations: number[] = [];
  const confidenceGate = new GestureCommandGate(
    (_candidate, timestamp) => confidenceActivations.push(timestamp),
  );
  confidenceGate.update(0, { source: InputSourceId.HAND_THUMB_UP, confidence: 0.54 });
  confidenceGate.update(200, { source: InputSourceId.HAND_THUMB_UP, confidence: 0.54 });
  check('confidence below 55% does not activate', confidenceActivations.length === 0);
  confidenceGate.update(300, { source: InputSourceId.HAND_THUMB_UP, confidence: 0.55 });
  confidenceGate.update(499, { source: InputSourceId.HAND_THUMB_UP, confidence: 0.55 });
  check('55% confidence still requires the full hold time', confidenceActivations.length === 0);
  confidenceGate.update(500, { source: InputSourceId.HAND_THUMB_UP, confidence: 0.55 });
  check('55% confidence activates after the configured hold', confidenceActivations[0] === 500);

  const perPoseActivations: InputSourceId[] = [];
  const perPoseGate = new GestureCommandGate(
    (candidate) => perPoseActivations.push(candidate.source),
    {
      ...DEFAULT_GESTURE_COMMAND_CONFIG,
      stabilityMsBySource: { [InputSourceId.HAND_CLOSED_FIST]: 120 },
    },
  );
  perPoseGate.update(0, { source: InputSourceId.HAND_CLOSED_FIST, confidence: 0.9 });
  perPoseGate.update(120, { source: InputSourceId.HAND_CLOSED_FIST, confidence: 0.9 });
  check('a saved pose-specific hold time overrides the default', perPoseActivations.length === 1);
  perPoseGate.reset();
  perPoseGate.update(1_000, { source: InputSourceId.HAND_OPEN_PALM, confidence: 0.9 });
  perPoseGate.update(1_120, { source: InputSourceId.HAND_OPEN_PALM, confidence: 0.9 });
  check('another pose keeps the default hold time', perPoseActivations.length === 1);

  /** Drives a tuner with a scripted pass/fail per cue and reports what it asked for. */
  function runTuner(
    outcome: (stabilityMs: number, seen: number) => boolean,
    confirmations = 5,
  ): { recommendation: number | null; cues: number[] } {
    const tuner = new RapidGestureTuner(confirmations);
    const cues: number[] = [];
    const seenCount = new Map<number, number>();
    while (tuner.pendingStabilityMs !== null && cues.length < 60) {
      const stabilityMs = tuner.pendingStabilityMs;
      const seen = (seenCount.get(stabilityMs) ?? 0) + 1;
      seenCount.set(stabilityMs, seen);
      cues.push(stabilityMs);
      tuner.record(outcome(stabilityMs, seen));
    }
    return { recommendation: tuner.recommendation, cues };
  }

  const flawless = runTuner(() => true);
  check(
    'a flawless run reaches the fastest hold and confirms it five times',
    flawless.recommendation === 120 &&
      flawless.cues.filter((stabilityMs) => stabilityMs === 120).length === 6,
  );
  check(
    'the staircase is not accepted on one descent alone',
    flawless.cues.length === RAPID_GESTURE_STABILITY_STEPS_MS.length + 5,
  );
  const brokeAt200 = runTuner((stabilityMs) => stabilityMs !== 200);
  check(
    'a failed step confirms the last hold that worked instead of ending there',
    brokeAt200.recommendation === 240 &&
      brokeAt200.cues.filter((stabilityMs) => stabilityMs === 240).length === 6,
  );
  let unstableFastRuns = 0;
  const unstableFast = runTuner((stabilityMs) => {
    if (stabilityMs !== 120) return true;
    unstableFastRuns += 1;
    // Passes the descent, then fails its third confirmation.
    return unstableFastRuns !== 4;
  });
  check(
    'a hold that only worked once steps back to the next slower hold',
    unstableFast.recommendation === 160,
  );
  check(
    'stepping back restarts confirmation from zero',
    unstableFast.cues.filter((stabilityMs) => stabilityMs === 160).length === 6,
  );
  check(
    'nothing is saved when the slowest hold cannot be confirmed',
    runTuner((stabilityMs) => stabilityMs === 320 ? false : true).recommendation === null,
  );
  check(
    'a hold that never survives repetition falls back through every step to nothing',
    runTuner((_stabilityMs, seen) => seen === 1).recommendation === null,
  );
  checkThrows('a tuner cannot be built without confirmations', () => new RapidGestureTuner(0));

  check(
    'frame-rate probe chooses the highest sustainable measured rate',
    recommendVisionInferenceFps([
      { requestedFps: 10, effectiveFps: 9.8, medianInferenceDurationMs: 20, sampleCount: 10 },
      { requestedFps: 12, effectiveFps: 11.7, medianInferenceDurationMs: 24, sampleCount: 12 },
      { requestedFps: 15, effectiveFps: 11.5, medianInferenceDurationMs: 25, sampleCount: 15 },
    ]) === 12,
  );
  check(
    'frame-rate probe refuses to decide from too few samples',
    recommendVisionInferenceFps([
      { requestedFps: 15, effectiveFps: 15, medianInferenceDurationMs: 10, sampleCount: 4 },
    ]) === null,
  );

  console.log('\nDevice-wide camera speed setting');
  const deviceTarget = new FakeVisionDevice();
  const deviceStore = new VisionTuningStore(new MemoryProfileStorage());
  const deviceSettings = new VisionDeviceSettings(deviceTarget, deviceStore);
  check(
    'camera speed offers every supported rate as one device-wide choice',
    deviceSettings.view().options.length === 3 && deviceSettings.view().selected === 15,
  );
  deviceTarget.isActive = false;
  const manualView = deviceSettings.select(10);
  check('a rate can be chosen manually while the camera is off', manualView.selected === 10);
  check('a manual choice is persisted for every visual input', deviceStore.load().inferenceFps === 10);
  check('manual choice is reported as the player’s own', manualView.origin === 'MANUAL');
  check('measuring is unavailable until the camera runs', !manualView.measurable);
  const refusedView = await deviceSettings.measure(recommendVisionInferenceFps);
  check('measuring with the camera off changes nothing', refusedView.selected === 10);
  deviceTarget.isActive = true;
  const measuredView = await deviceSettings.measure(recommendVisionInferenceFps);
  check('a measurement applies the fastest sustained rate', measuredView.selected === 12);
  check('a measured choice is persisted too', deviceStore.load().inferenceFps === 12);
  check(
    'each rate reports what it actually achieved',
    measuredView.options.find((option) => option.fps === 12)?.measured?.effectiveFps === 11.7,
  );
  check('a measured choice is reported as measured', measuredView.origin === 'MEASURED');
  checkThrows('an unsupported camera rate is rejected', () => {
    deviceSettings.select(30 as VisionInferenceFps);
  });

  checkThrows('vision timing options reject values above their bound', () => {
    new VisionInputChannel({} as HTMLVideoElement, { gestureTiming: { stabilityMs: 2_001 } });
  });

  const focusedVision = new VisionInputChannel({} as HTMLVideoElement);
  focusedVision.focusTriggerSource(InputSourceId.HAND_OPEN_PALM);
  check(
    'calibration can focus one game-blind trigger source',
    focusedVision.focusedTriggerSource === InputSourceId.HAND_OPEN_PALM,
  );
  focusedVision.focusTriggerSource(null);
  check('clearing calibration focus restores normal arbitration', focusedVision.focusedTriggerSource === null);
  checkThrows('direction input cannot be selected as a trigger focus', () => {
    focusedVision.focusTriggerSource(InputSourceId.HAND_POINT_DIRECTION);
  });

  console.log('\nPoint direction stability');
  const pointTracker = new PointDirectionTracker();
  const initialDirection = pointTracker.update(pointLandmarks(0, 180, 90), 0);
  const smallChange = pointTracker.update(pointLandmarks(2, 180, 90), 67);
  check(
    'four-degree dead zone suppresses small direction wobble',
    initialDirection !== null &&
      smallChange?.x === initialDirection.x &&
      smallChange.y === initialDirection.y,
  );
  const transientLoss = pointTracker.update([], 134);
  check(
    'brief landmark loss holds the previous direction',
    transientLoss?.x === smallChange?.x && transientLoss?.y === smallChange?.y,
  );
  const tolerantRecovery = pointTracker.update(pointLandmarks(10, 150, 140), 200);
  check('an active point uses the looser hold angles', tolerantRecovery !== null);
  check('direction remains active after recovery within grace', pointTracker.isActive);
  check(
    'loss grace remains active through its 180 ms boundary',
    pointTracker.update([], 380) !== null,
  );
  check(
    'continued landmark loss ends direction after the grace period',
    pointTracker.update([], 381) === null && !pointTracker.isActive,
  );

  const strictEntryTracker = new PointDirectionTracker();
  check(
    'looser hold angles cannot start a new pointing session',
    strictEntryTracker.update(pointLandmarks(10, 150, 140), 0) === null,
  );

  const competingTracker = new PointDirectionTracker();
  competingTracker.update(pointLandmarks(0, 180, 90), 0);
  check(
    'a single competing gesture frame does not release pointing',
    competingTracker.update(pointLandmarks(0, 180, 90), 67, true) !== null,
  );
  check(
    'a competing gesture held to its confirmation does release pointing',
    competingTracker.update(pointLandmarks(0, 180, 90), 267, true) === null,
  );
  const flickerTracker = new PointDirectionTracker();
  flickerTracker.update(pointLandmarks(0, 180, 90), 0);
  flickerTracker.update(pointLandmarks(0, 180, 90), 67, true);
  flickerTracker.update(pointLandmarks(0, 180, 90), 134);
  check(
    'an interrupted competing gesture restarts its confirmation window',
    flickerTracker.update(pointLandmarks(0, 180, 90), 267, true) !== null,
  );

  const unclearShapeTracker = new PointDirectionTracker();
  unclearShapeTracker.update(pointLandmarks(0, 180, 90), 0);
  check(
    'a visible hand with an unclear shape outlasts the 180 ms loss grace',
    unclearShapeTracker.update(pointLandmarks(0, 100, 90), 240) !== null,
  );
  check(
    'an unclear shape still ends pointing after its own 300 ms grace',
    unclearShapeTracker.update(pointLandmarks(0, 100, 90), 301) === null,
  );

  const tunedPointTracker = new PointDirectionTracker();
  tunedPointTracker.setStabilityMs(120);
  tunedPointTracker.update(pointLandmarks(0, 180, 90), 0);
  check('raw shape observation is reported for gap measurement', tunedPointTracker.isShapeObserved);
  check(
    'a saved pointing stability shortens the loss grace',
    tunedPointTracker.update([], 121) === null && !tunedPointTracker.isShapeObserved,
  );

  check(
    'pointing stability recommendation covers the measured gaps',
    recommendPointStabilityMs([80, 90, 150, 170]) === 180,
  );
  check(
    'one isolated long gap does not force the slowest pointing setting',
    recommendPointStabilityMs([60, 70, 80, 90, 95, 100, 110, 115, 120, 900]) === 120,
  );
  check('measuring no gaps recommends the shortest pointing setting', recommendPointStabilityMs([]) === 120);
  check(
    'gaps longer than every candidate fall back to the most tolerant setting',
    recommendPointStabilityMs([500, 600]) === 360,
  );

  if (failures.length > 0) {
    throw new Error(`${failures.length} adaptive-input check(s) failed: ${failures.join(', ')}`);
  }
  console.log('\nAll adaptive-input checks passed.\n');
}

await main();

function pointLandmarks(
  directionDeg: number,
  indexAngleDeg: number,
  foldedAngleDeg: number,
): readonly { x: number; y: number; z: number }[] {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  setFinger(landmarks, 5, 6, 8, 0.2, directionDeg, indexAngleDeg);
  setFinger(landmarks, 9, 10, 12, 0.4, directionDeg, foldedAngleDeg);
  setFinger(landmarks, 13, 14, 16, 0.6, directionDeg, foldedAngleDeg);
  setFinger(landmarks, 17, 18, 20, 0.8, directionDeg, foldedAngleDeg);
  return landmarks;
}

function setFinger(
  landmarks: { x: number; y: number; z: number }[],
  mcpIndex: number,
  pipIndex: number,
  tipIndex: number,
  baseY: number,
  directionDeg: number,
  jointAngleDeg: number,
): void {
  const directionRad = directionDeg * Math.PI / 180;
  const nextSegmentRad = directionRad + Math.PI - jointAngleDeg * Math.PI / 180;
  const segmentLength = 0.1;
  const mcp = { x: 0.3, y: baseY, z: 0 };
  const pip = {
    x: mcp.x + Math.cos(directionRad) * segmentLength,
    y: mcp.y + Math.sin(directionRad) * segmentLength,
    z: 0,
  };
  landmarks[mcpIndex] = mcp;
  landmarks[pipIndex] = pip;
  landmarks[tipIndex] = {
    x: pip.x + Math.cos(nextSegmentRad) * segmentLength,
    y: pip.y + Math.sin(nextSegmentRad) * segmentLength,
    z: 0,
  };
}
