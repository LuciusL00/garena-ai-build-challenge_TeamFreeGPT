/** Executable acceptance check for the portable input spine. */

import {
  AdaptiveInput,
  BindingSettingsController,
  CalibrationProfile,
  CalibrationProfileStore,
  ChannelManager,
  ControlRecommender,
  InputChannelId,
  InputSourceId,
  scoreCalibration,
} from '../index.ts';
import type {
  CalibrationSession,
  ChannelContext,
  InputChannel,
  ProfileStorage,
} from '../index.ts';

type EmptyPayload = Record<string, never>;

interface TestActions {
  BEGIN_ROUND: EmptyPayload;
  RESTART_ROUND: EmptyPayload;
  TOGGLE_SQUAD: EmptyPayload;
  LASSO_START: { x: number; y: number };
  LASSO_END: { x: number; y: number };
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
      id: 'LASSO_START',
      requirements: { task: 'POINT', spatial: true, latencyCritical: false },
      defaultSource: InputSourceId.TOUCH_POINTER,
      remappable: false,
    },
    {
      id: 'LASSO_END',
      requirements: { task: 'POINT', spatial: true, latencyCritical: false },
      defaultSource: InputSourceId.TOUCH_POINTER,
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
    'one touch-pointer source backs lasso boundaries',
    adaptive.bindings.get('LASSO_START') === InputSourceId.TOUCH_POINTER &&
      adaptive.bindings.get('LASSO_END') === InputSourceId.TOUCH_POINTER,
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
        extraActivations: 0,
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
        extraActivations: 0,
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
        extraActivations: 0,
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
        extraActivations: 0,
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
      extraActivations: 0,
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
  check(
    'latency-critical metadata does not automatically reject a measured winner',
    recommender.recommend(
      {
        ...request,
        requirements: { task: 'TRIGGER', spatial: false, latencyCritical: true },
      },
      clearlyBetterProfile,
    ).verdict === 'swap',
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

  if (failures.length > 0) {
    throw new Error(`${failures.length} adaptive-input check(s) failed: ${failures.join(', ')}`);
  }
  console.log('\nAll adaptive-input checks passed.\n');
}

await main();
