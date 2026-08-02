/** Action-attempt telemetry. Recording always happens before binding checks. */

import type { ActionId } from './actions.ts';
import type {
  EmissionMeta,
  InputSourceId,
  MeasurementPhase,
} from './sources.ts';

export interface EmissionRecord<A extends ActionId = ActionId> {
  action: A;
  source: InputSourceId;
  timestamp: number;
  confidence?: number;
  sessionId?: string;
  phase?: MeasurementPhase;
  /** False when the binding gate rejected the attempt. */
  dispatched: boolean;
}

export class TelemetryRecorder<A extends ActionId = ActionId> {
  private readonly records: EmissionRecord<A>[] = [];
  private readonly subscribers = new Set<(record: EmissionRecord<A>) => void>();

  record(action: A, meta: EmissionMeta, dispatched: boolean): void {
    const entry: EmissionRecord<A> = {
      action,
      source: meta.source,
      timestamp: meta.timestamp,
      dispatched,
    };
    if (meta.confidence !== undefined) entry.confidence = meta.confidence;
    if (meta.sessionId !== undefined) entry.sessionId = meta.sessionId;
    if (meta.phase !== undefined) entry.phase = meta.phase;

    this.records.push(entry);
    this.subscribers.forEach((subscriber) => subscriber(entry));
  }

  subscribe(subscriber: (record: EmissionRecord<A>) => void): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  all(): readonly EmissionRecord<A>[] {
    return this.records;
  }

  since(timestamp: number): readonly EmissionRecord<A>[] {
    return this.records.filter((record) => record.timestamp >= timestamp);
  }

  forSession(sessionId: string): readonly EmissionRecord<A>[] {
    return this.records.filter((record) => record.sessionId === sessionId);
  }

  rejected(): readonly EmissionRecord<A>[] {
    return this.records.filter((record) => !record.dispatched);
  }

  clear(): void {
    this.records.length = 0;
  }
}
