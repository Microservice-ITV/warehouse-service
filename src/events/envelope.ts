import { randomUUID } from 'crypto';

export interface EventEnvelope<TEvent extends string, TData> {
  event_id: string;
  event: TEvent;
  version: 'v1';
  timestamp: string;
  producer: 'warehouse-service';
  correlation_id: string;
  data: TData;
}

export const createEventEnvelope = <TEvent extends string, TData>(params: {
  event: TEvent;
  correlationId: string;
  data: TData;
}): EventEnvelope<TEvent, TData> => ({
  event_id: randomUUID(),
  event: params.event,
  version: 'v1',
  timestamp: new Date().toISOString(),
  producer: 'warehouse-service',
  correlation_id: params.correlationId,
  data: params.data,
});
