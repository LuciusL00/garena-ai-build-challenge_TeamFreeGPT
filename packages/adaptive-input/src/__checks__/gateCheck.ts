/** Executable acceptance check for the portable input spine. */

import {
  AdaptiveInput,
  ChannelManager,
  InputChannelId,
  InputSourceId,
} from '../index.ts';
import type { ChannelContext, InputChannel } from '../index.ts';

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

async function main(): Promise<void> {
  const adaptive = new AdaptiveInput<TestActions>();
  adaptive.registerActions([
    {
      id: 'BEGIN_ROUND',
      requirements: { spatial: false, latencyCritical: false },
      defaultSource: InputSourceId.TOUCH_BUTTON,
      remappable: false,
    },
    {
      id: 'RESTART_ROUND',
      requirements: { spatial: false, latencyCritical: false },
      defaultSource: InputSourceId.TOUCH_BUTTON,
      remappable: false,
    },
    {
      id: 'TOGGLE_SQUAD',
      requirements: { spatial: false, latencyCritical: false },
      defaultSource: InputSourceId.TOUCH_BUTTON,
      remappable: true,
    },
    {
      id: 'LASSO_START',
      requirements: { spatial: true, latencyCritical: false },
      defaultSource: InputSourceId.TOUCH_POINTER,
      remappable: false,
    },
    {
      id: 'LASSO_END',
      requirements: { spatial: true, latencyCritical: false },
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

  if (failures.length > 0) {
    throw new Error(`${failures.length} adaptive-input check(s) failed: ${failures.join(', ')}`);
  }
  console.log('\nAll adaptive-input checks passed.\n');
}

await main();
