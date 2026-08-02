/** Contracts and lifecycle coordination for platform-specific input channels. */

import type { InputChannelId, InputSignal, InputSourceId } from './sources.ts';

export interface ChannelContext {
  /** Report an input signal without naming or invoking a game action. */
  emit(signal: InputSignal): void;
}

export interface InputChannel {
  readonly id: InputChannelId;
  readonly sources: readonly InputSourceId[];
  /** Acquire resources such as listeners or a camera stream. */
  start(ctx: ChannelContext): Promise<void>;
  /** Release every acquired resource. Safe when already stopped. */
  stop(): void;
  readonly isActive: boolean;
}

export class ChannelUnavailableError extends Error {
  constructor(
    readonly channel: InputChannelId,
    readonly reason: 'permission-denied' | 'not-supported' | 'load-failed',
    message: string,
  ) {
    super(message);
    this.name = 'ChannelUnavailableError';
  }
}

export interface ChannelStartFailure {
  channel: InputChannelId;
  error: unknown;
}

/**
 * Starts only required channels and stops channels that are no longer needed.
 * Reconciliations are serialized so rapid rebinds cannot start a camera twice.
 */
export class ChannelManager {
  private readonly channels = new Map<InputChannelId, InputChannel>();
  private transition: Promise<void> = Promise.resolve();

  constructor(private readonly context: ChannelContext) {}

  register(channel: InputChannel): void {
    if (this.channels.has(channel.id)) {
      throw new Error(`Input channel "${channel.id}" is already registered.`);
    }
    this.channels.set(channel.id, channel);
  }

  registered(): readonly InputChannel[] {
    return [...this.channels.values()];
  }

  reconcile(required: ReadonlySet<InputChannelId>): Promise<readonly ChannelStartFailure[]> {
    const run = this.transition.then(() => this.applyRequiredChannels(required));
    this.transition = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async stopAll(): Promise<void> {
    await this.transition;
    this.channels.forEach((channel) => channel.stop());
  }

  private async applyRequiredChannels(
    required: ReadonlySet<InputChannelId>,
  ): Promise<readonly ChannelStartFailure[]> {
    const failures: ChannelStartFailure[] = [];

    this.channels.forEach((channel, id) => {
      if (!required.has(id) && channel.isActive) channel.stop();
    });

    for (const [id, channel] of this.channels) {
      if (!required.has(id) || channel.isActive) continue;
      try {
        await channel.start(this.context);
      } catch (error: unknown) {
        channel.stop();
        failures.push({ channel: id, error });
      }
    }

    return failures;
  }
}
