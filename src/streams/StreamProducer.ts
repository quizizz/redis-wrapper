'use strict';

import { Redis, Cluster } from 'ioredis';
import EventEmitter from 'events';
import { DEFAULTS } from './constants';

type RedisClient = Redis | Cluster;

const NOOP_EMITTER = { emit() {} } as unknown as EventEmitter;

/**
 * Produces messages to Redis Streams via XADD.
 *
 * Payload format: `{ content, correlationId, meta, replyTo }` JSON-stringified
 * into a single `payload` field. StreamConsumer parses it back.
 *
 * @example
 *   const producer = new StreamProducer(redisClient, emitter);
 *   await producer.send('stream:topic', content, { correlationId }, meta);
 */
class StreamProducer {
  private _client: RedisClient;
  private _emitter: EventEmitter;

  /**
   * @param redisClient - ioredis client (Redis or Cluster instance)
   * @param emitter - emits 'error' events
   */
  constructor(redisClient: RedisClient, emitter?: EventEmitter) {
    this._client = redisClient;
    this._emitter = emitter || NOOP_EMITTER;
  }

  /**
   * @param streamName - e.g. 'stream:socket-request'
   * @param content    - message body
   * @param options    - { correlationId, replyTo }
   * @param meta       - { traceId, startTime, ... }
   * @param maxLen     - MAXLEN ~ trimming threshold
   * @returns stream entry ID
   */
  async send(
    streamName: string,
    content: Record<string, unknown>,
    options: { correlationId?: string; replyTo?: string } = {},
    meta: Record<string, unknown> = {},
    maxLen: number = DEFAULTS.MAX_LEN,
  ): Promise<string> {
    const payload = JSON.stringify({
      content,
      correlationId: options.correlationId || null,
      meta,
      replyTo: options.replyTo || null,
    });

    // ioredis: XADD key MAXLEN ~ threshold * field value
    return this._client.xadd(
      streamName, 'MAXLEN', '~', String(maxLen), '*', 'payload', payload,
    );
  }
}

export { StreamProducer };
