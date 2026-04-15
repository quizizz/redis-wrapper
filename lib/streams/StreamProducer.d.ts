/// <reference types="node" />
import { Redis, Cluster } from 'ioredis';
import EventEmitter from 'events';
type RedisClient = Redis | Cluster;
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
declare class StreamProducer {
    private _client;
    private _emitter;
    /**
     * @param redisClient - ioredis client (Redis or Cluster instance)
     * @param emitter - emits 'error' events
     */
    constructor(redisClient: RedisClient, emitter?: EventEmitter);
    /**
     * @param streamName - e.g. 'stream:socket-request'
     * @param content    - message body
     * @param options    - { correlationId, replyTo }
     * @param meta       - { traceId, startTime, ... }
     * @param maxLen     - MAXLEN ~ trimming threshold
     * @returns stream entry ID
     */
    send(streamName: string, content: Record<string, unknown>, options?: {
        correlationId?: string;
        replyTo?: string;
    }, meta?: Record<string, unknown>, maxLen?: number): Promise<string>;
}
export { StreamProducer };
