'use strict';

import { Redis, Cluster } from 'ioredis';
import EventEmitter from 'events';
import { DEFAULTS } from './constants';

type RedisClient = Redis | Cluster;

const NOOP_EMITTER = { emit() {} } as unknown as EventEmitter;
const SERVICE_NAME = 'StreamConsumer';

interface StreamEntry {
  id: string;
  message: Record<string, string>;
}

interface SubscribeOptions {
  group?: string;
  consumer?: string;
  blockMs?: number;
  count?: number;
  ttlSeconds?: number;
}

/**
 * Convert ioredis raw stream entry [id, [f1, v1, f2, v2, ...]]
 * into { id, message: { f1: v1, f2: v2, ... } }.
 */
function normalizeEntry(raw: [string, string[]]): StreamEntry {
  const [id, fields] = raw;
  const message: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    message[fields[i]] = fields[i + 1];
  }
  return { id, message };
}

function _sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Consumes messages from Redis Streams via XREAD (single reader) or XREADGROUP (consumer group).
 *
 * Parses each entry into: { content, correlationId, meta, redelivered, _transport, ack() }
 *
 * For per-instance streams (SINGLE mode), automatically refreshes an EXPIRE on the stream key
 * so Redis auto-deletes it if the consumer dies (autoDelete equivalent).
 *
 * Emits:
 *   'error'  { service, message, data, err }  - on XREAD/XREADGROUP errors, parse failures, XACK failures
 *
 * @example
 *   const consumer = new StreamConsumer(redisClient, emitter);
 *   consumer.subscribe('stream:reply-abc', handler, { ttlSeconds: 300 });
 *   consumer.subscribe('stream:broadcast', handler, { group: 'cg:app', consumer: 'pod-1' });
 *   await consumer.stop();
 */
class StreamConsumer {
  private _client: RedisClient;
  private _emitter: EventEmitter;
  private _running: boolean;
  private _pelTimers: ReturnType<typeof setInterval>[];

  /**
   * @param redisClient - ioredis client (Redis or Cluster instance)
   * @param emitter - emits 'error' events
   */
  constructor(redisClient: RedisClient, emitter?: EventEmitter) {
    this._client = redisClient;
    this._emitter = emitter || NOOP_EMITTER;
    this._running = false;
    this._pelTimers = [];
  }

  private _error(message: string, data: Record<string, unknown> = {}) {
    this._emitter.emit('error', { service: SERVICE_NAME, message, data });
  }

  /**
   * Start consuming from a stream. Non-blocking - spawns an async loop.
   *
   * @param streamName
   * @param handler
   * @param options.group      - consumer group (XREADGROUP mode)
   * @param options.consumer   - consumer name within the group
   * @param options.blockMs    - BLOCK timeout (default 5000)
   * @param options.count      - max entries per read (default 100)
   * @param options.ttlSeconds - EXPIRE TTL for autoDelete (SINGLE mode)
   */
  subscribe(
    streamName: string,
    handler: (msg: any) => Promise<void>,
    options: SubscribeOptions = {},
  ) {
    this._running = true;

    if (options.group && options.consumer) {
      this._pollGroup(streamName, handler, options);
      this._startPELReclaimer(streamName, handler, options.group, options.consumer);
    } else {
      this._pollRead(streamName, handler, options);
    }
  }

  /** Stop all polling loops and PEL reclaimers. */
  async stop() {
    this._running = false;
    for (const timer of this._pelTimers) clearInterval(timer);
    this._pelTimers = [];
  }

  // -- XREAD (per-instance, single reader) --------------------------------

  private async _pollRead(
    streamName: string,
    handler: (msg: any) => Promise<void>,
    options: SubscribeOptions,
  ) {
    const blockMs = options.blockMs ?? DEFAULTS.BLOCK_MS;
    const count = options.count ?? DEFAULTS.COUNT;
    const ttlSeconds = options.ttlSeconds ?? DEFAULTS.STREAM_TTL_SECONDS;
    let lastId = '$';
    let lastTtlRefresh = 0;

    while (this._running) {
      const now = Date.now();
      if (now - lastTtlRefresh >= DEFAULTS.TTL_REFRESH_INTERVAL_MS) {
        await this._client.expire(streamName, ttlSeconds).catch(() => {});
        lastTtlRefresh = now;
      }

      try {
        // ioredis: XREAD COUNT n BLOCK ms STREAMS key id
        const response: any = await this._client.xread(
          'COUNT', count, 'BLOCK', blockMs, 'STREAMS', streamName, lastId,
        );
        if (!response) {
          // eslint-disable-next-line no-continue
          continue;
        }

        // response: [[streamName, [[entryId, [field, value, ...]], ...]]]
        for (const [, entries] of response as [string, [string, string[]][]][]) {
          for (const rawEntry of entries) {
            const entry = normalizeEntry(rawEntry);
            lastId = entry.id;
            await this._dispatch(entry, streamName, null, false, handler);
          }
        }
      } catch (err: any) {
        if (!this._running) break;
        this._error('XREAD error', { stream: streamName, error: err.message });
        await _sleep(1000);
      }
    }
  }

  // -- XREADGROUP (shared, consumer group) --------------------------------

  private async _pollGroup(
    streamName: string,
    handler: (msg: any) => Promise<void>,
    options: SubscribeOptions,
  ) {
    const { group, consumer } = options;
    const blockMs = options.blockMs ?? DEFAULTS.BLOCK_MS;
    const count = options.count ?? DEFAULTS.COUNT;

    while (this._running) {
      try {
        // ioredis: XREADGROUP GROUP g c COUNT n BLOCK ms STREAMS key >
        const response: any = await this._client.xreadgroup(
          'GROUP', group, consumer,
          'COUNT', count, 'BLOCK', blockMs,
          'STREAMS', streamName, '>',
        );
        if (!response) {
          // eslint-disable-next-line no-continue
          continue;
        }

        // response: [[streamName, [[entryId, [field, value, ...]], ...]]]
        for (const [, entries] of response as [string, [string, string[]][]][]) {
          for (const rawEntry of entries) {
            const entry = normalizeEntry(rawEntry);
            await this._dispatch(entry, streamName, group, false, handler);
          }
        }
      } catch (err: any) {
        if (!this._running) break;
        this._error('XREADGROUP error', { stream: streamName, group, consumer, error: err.message });
        await _sleep(1000);
      }
    }
  }

  // -- PEL reclaimer ------------------------------------------------------

  private _startPELReclaimer(
    streamName: string,
    handler: (msg: any) => Promise<void>,
    group: string,
    consumer: string,
  ) {
    const timer = setInterval(async () => {
      if (!this._running) return;
      try {
        // ioredis: XAUTOCLAIM key group consumer minIdleMs startId COUNT n
        // returns [nextStartId, [[entryId, [fields...]], ...], deletedIds?]
        const result: any = await this._client.xautoclaim(
          streamName, group, consumer,
          DEFAULTS.PEL_MIN_IDLE_MS, '0-0',
          'COUNT', DEFAULTS.PEL_COUNT,
        );
        const entries = (result[1] || []) as ([string, string[]] | null)[];
        for (const rawEntry of entries) {
          if (!rawEntry || !rawEntry[1]) {
            // eslint-disable-next-line no-continue
            continue;
          }
          const entry = normalizeEntry(rawEntry as [string, string[]]);
          await this._dispatch(entry, streamName, group, true, handler);
        }
      } catch (err: any) {
        if (!err.message?.includes('NOGROUP')) {
          this._error('XAUTOCLAIM error', { stream: streamName, group, error: err.message });
        }
      }
    }, DEFAULTS.PEL_INTERVAL_MS);
    this._pelTimers.push(timer);
  }

  // -- Dispatch -----------------------------------------------------------

  private async _dispatch(
    entry: StreamEntry,
    streamName: string,
    group: string | null,
    redelivered: boolean,
    handler: (msg: any) => Promise<void>,
  ) {
    const msg = this._parseEntry(entry, streamName, group, redelivered);
    try {
      await handler(msg);
    } catch (err: any) {
      this._error('Handler error', { stream: streamName, entryId: entry.id, error: err.message });
    }
  }

  private _parseEntry(
    entry: StreamEntry,
    streamName: string,
    group: string | null = null,
    redelivered: boolean = false,
  ) {
    let parsed: any;
    try {
      parsed = JSON.parse(entry.message.payload);
    } catch {
      this._error('Payload parse error', { stream: streamName, entryId: entry.id });
      parsed = {};
    }

    const entryId = entry.id;
    const client = this._client;
    const emitter = this._emitter;

    return {
      content: {},
      correlationId: null,
      meta: {},
      replyTo: null,
      ...parsed,
      redelivered,
      _transport: 'redis-streams',
      ack() {
        if (!group) return Promise.resolve();
        return client.xack(streamName, group, entryId).catch((err: any) => {
          emitter.emit('error', {
            service: SERVICE_NAME,
            message: 'XACK error',
            data: { stream: streamName, group, entryId, error: err.message },
          });
        });
      },
    };
  }
}

export { StreamConsumer };
