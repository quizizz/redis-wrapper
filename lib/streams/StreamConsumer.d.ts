/// <reference types="node" />
import { Redis, Cluster } from 'ioredis';
import EventEmitter from 'events';
type RedisClient = Redis | Cluster;
interface SubscribeOptions {
    group?: string;
    consumer?: string;
    blockMs?: number;
    count?: number;
    ttlSeconds?: number;
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
declare class StreamConsumer {
    private _client;
    private _emitter;
    private _running;
    private _pelTimers;
    /**
     * @param redisClient - ioredis client (Redis or Cluster instance)
     * @param emitter - emits 'error' events
     */
    constructor(redisClient: RedisClient, emitter?: EventEmitter);
    private _error;
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
    subscribe(streamName: string, handler: (msg: any) => Promise<void>, options?: SubscribeOptions): void;
    /** Stop all polling loops and PEL reclaimers. */
    stop(): Promise<void>;
    private _pollRead;
    private _pollGroup;
    private _startPELReclaimer;
    private _dispatch;
    private _parseEntry;
}
export { StreamConsumer };
