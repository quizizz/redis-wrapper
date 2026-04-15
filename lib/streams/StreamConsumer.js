'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamConsumer = void 0;
const constants_1 = require("./constants");
const NOOP_EMITTER = { emit() { } };
const SERVICE_NAME = 'StreamConsumer';
/**
 * Convert ioredis raw stream entry [id, [f1, v1, f2, v2, ...]]
 * into { id, message: { f1: v1, f2: v2, ... } }.
 */
function normalizeEntry(raw) {
    const [id, fields] = raw;
    const message = {};
    for (let i = 0; i < fields.length; i += 2) {
        message[fields[i]] = fields[i + 1];
    }
    return { id, message };
}
function _sleep(ms) {
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
    _client;
    _emitter;
    _running;
    _pelTimers;
    /**
     * @param redisClient - ioredis client (Redis or Cluster instance)
     * @param emitter - emits 'error' events
     */
    constructor(redisClient, emitter) {
        this._client = redisClient;
        this._emitter = emitter || NOOP_EMITTER;
        this._running = false;
        this._pelTimers = [];
    }
    _error(message, data = {}) {
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
    subscribe(streamName, handler, options = {}) {
        this._running = true;
        if (options.group && options.consumer) {
            this._pollGroup(streamName, handler, options);
            this._startPELReclaimer(streamName, handler, options.group, options.consumer);
        }
        else {
            this._pollRead(streamName, handler, options);
        }
    }
    /** Stop all polling loops and PEL reclaimers. */
    async stop() {
        this._running = false;
        for (const timer of this._pelTimers)
            clearInterval(timer);
        this._pelTimers = [];
    }
    // -- XREAD (per-instance, single reader) --------------------------------
    async _pollRead(streamName, handler, options) {
        const blockMs = options.blockMs ?? constants_1.DEFAULTS.BLOCK_MS;
        const count = options.count ?? constants_1.DEFAULTS.COUNT;
        const ttlSeconds = options.ttlSeconds ?? constants_1.DEFAULTS.STREAM_TTL_SECONDS;
        let lastId = '$';
        let lastTtlRefresh = 0;
        while (this._running) {
            const now = Date.now();
            if (now - lastTtlRefresh >= constants_1.DEFAULTS.TTL_REFRESH_INTERVAL_MS) {
                await this._client.expire(streamName, ttlSeconds).catch(() => { });
                lastTtlRefresh = now;
            }
            try {
                // ioredis: XREAD COUNT n BLOCK ms STREAMS key id
                const response = await this._client.xread('COUNT', count, 'BLOCK', blockMs, 'STREAMS', streamName, lastId);
                if (!response)
                    continue;
                // response: [[streamName, [[entryId, [field, value, ...]], ...]]]
                for (const [, entries] of response) {
                    for (const rawEntry of entries) {
                        const entry = normalizeEntry(rawEntry);
                        lastId = entry.id;
                        await this._dispatch(entry, streamName, null, false, handler);
                    }
                }
            }
            catch (err) {
                if (!this._running)
                    break;
                this._error('XREAD error', { stream: streamName, error: err.message });
                await _sleep(1000);
            }
        }
    }
    // -- XREADGROUP (shared, consumer group) --------------------------------
    async _pollGroup(streamName, handler, options) {
        const { group, consumer } = options;
        const blockMs = options.blockMs ?? constants_1.DEFAULTS.BLOCK_MS;
        const count = options.count ?? constants_1.DEFAULTS.COUNT;
        while (this._running) {
            try {
                // ioredis: XREADGROUP GROUP g c COUNT n BLOCK ms STREAMS key >
                const response = await this._client.xreadgroup('GROUP', group, consumer, 'COUNT', count, 'BLOCK', blockMs, 'STREAMS', streamName, '>');
                if (!response)
                    continue;
                // response: [[streamName, [[entryId, [field, value, ...]], ...]]]
                for (const [, entries] of response) {
                    for (const rawEntry of entries) {
                        const entry = normalizeEntry(rawEntry);
                        await this._dispatch(entry, streamName, group, false, handler);
                    }
                }
            }
            catch (err) {
                if (!this._running)
                    break;
                this._error('XREADGROUP error', { stream: streamName, group, consumer, error: err.message });
                await _sleep(1000);
            }
        }
    }
    // -- PEL reclaimer ------------------------------------------------------
    _startPELReclaimer(streamName, handler, group, consumer) {
        const timer = setInterval(async () => {
            if (!this._running)
                return;
            try {
                // ioredis: XAUTOCLAIM key group consumer minIdleMs startId COUNT n
                // returns [nextStartId, [[entryId, [fields...]], ...], deletedIds?]
                const result = await this._client.xautoclaim(streamName, group, consumer, constants_1.DEFAULTS.PEL_MIN_IDLE_MS, '0-0', 'COUNT', constants_1.DEFAULTS.PEL_COUNT);
                const entries = (result[1] || []);
                for (const rawEntry of entries) {
                    if (!rawEntry || !rawEntry[1])
                        continue;
                    const entry = normalizeEntry(rawEntry);
                    await this._dispatch(entry, streamName, group, true, handler);
                }
            }
            catch (err) {
                if (!err.message?.includes('NOGROUP')) {
                    this._error('XAUTOCLAIM error', { stream: streamName, group, error: err.message });
                }
            }
        }, constants_1.DEFAULTS.PEL_INTERVAL_MS);
        this._pelTimers.push(timer);
    }
    // -- Dispatch -----------------------------------------------------------
    async _dispatch(entry, streamName, group, redelivered, handler) {
        const msg = this._parseEntry(entry, streamName, group, redelivered);
        try {
            await handler(msg);
        }
        catch (err) {
            this._error('Handler error', { stream: streamName, entryId: entry.id, error: err.message });
        }
    }
    _parseEntry(entry, streamName, group = null, redelivered = false) {
        let parsed;
        try {
            parsed = JSON.parse(entry.message.payload);
        }
        catch {
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
                if (!group)
                    return Promise.resolve();
                return client.xack(streamName, group, entryId).catch((err) => {
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
exports.StreamConsumer = StreamConsumer;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU3RyZWFtQ29uc3VtZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvc3RyZWFtcy9TdHJlYW1Db25zdW1lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZLENBQUM7OztBQUliLDJDQUF1QztBQUl2QyxNQUFNLFlBQVksR0FBRyxFQUFFLElBQUksS0FBSSxDQUFDLEVBQTZCLENBQUM7QUFDOUQsTUFBTSxZQUFZLEdBQUcsZ0JBQWdCLENBQUM7QUFldEM7OztHQUdHO0FBQ0gsU0FBUyxjQUFjLENBQUMsR0FBdUI7SUFDN0MsTUFBTSxDQUFDLEVBQUUsRUFBRSxNQUFNLENBQUMsR0FBRyxHQUFHLENBQUM7SUFDekIsTUFBTSxPQUFPLEdBQTJCLEVBQUUsQ0FBQztJQUMzQyxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUFDLElBQUksQ0FBQyxFQUFFO1FBQ3pDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxNQUFNLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO0tBQ3BDO0lBQ0QsT0FBTyxFQUFFLEVBQUUsRUFBRSxPQUFPLEVBQUUsQ0FBQztBQUN6QixDQUFDO0FBRUQsU0FBUyxNQUFNLENBQUMsRUFBVTtJQUN4QixPQUFPLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUM7QUFDM0QsQ0FBQztBQUVEOzs7Ozs7Ozs7Ozs7Ozs7O0dBZ0JHO0FBQ0gsTUFBTSxjQUFjO0lBQ1YsT0FBTyxDQUFjO0lBQ3JCLFFBQVEsQ0FBZTtJQUN2QixRQUFRLENBQVU7SUFDbEIsVUFBVSxDQUFtQztJQUVyRDs7O09BR0c7SUFDSCxZQUFZLFdBQXdCLEVBQUUsT0FBc0I7UUFDMUQsSUFBSSxDQUFDLE9BQU8sR0FBRyxXQUFXLENBQUM7UUFD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