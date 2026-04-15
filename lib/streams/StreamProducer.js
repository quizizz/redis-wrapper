'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamProducer = void 0;
const constants_1 = require("./constants");
const NOOP_EMITTER = { emit() { } };
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
    _client;
    _emitter;
    /**
     * @param redisClient - ioredis client (Redis or Cluster instance)
     * @param emitter - emits 'error' events
     */
    constructor(redisClient, emitter) {
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
    async send(streamName, content, options = {}, meta = {}, maxLen = constants_1.DEFAULTS.MAX_LEN) {
        const payload = JSON.stringify({
            content,
            correlationId: options.correlationId || null,
            meta,
            replyTo: options.replyTo || null,
        });
        // ioredis: XADD key MAXLEN ~ threshold * field value
        return this._client.xadd(streamName, 'MAXLEN', '~', String(maxLen), '*', 'payload', payload);
    }
}
exports.StreamProducer = StreamProducer;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU3RyZWFtUHJvZHVjZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvc3RyZWFtcy9TdHJlYW1Qcm9kdWNlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZLENBQUM7OztBQUliLDJDQUF1QztBQUl2QyxNQUFNLFlBQVksR0FBRyxFQUFFLElBQUksS0FBSSxDQUFDLEVBQTZCLENBQUM7QUFFOUQ7Ozs7Ozs7OztHQVNHO0FBQ0gsTUFBTSxjQUFjO0lBQ1YsT0FBTyxDQUFjO0lBQ3JCLFFBQVEsQ0FBZTtJQUUvQjs7O09BR0c7SUFDSCxZQUFZLFdBQXdCLEVBQUUsT0FBc0I7UUFDMUQsSUFBSSxDQUFDLE9BQU8sR0FBRyxXQUFXLENBQUM7UUFDM0IsSUFBSSxDQUFDLFFBQVEsR0FBRyxPQUFPLElBQUksWUFBWSxDQUFDO0lBQzFDLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLElBQUksQ0FDUixVQUFrQixFQUNsQixPQUFnQyxFQUNoQyxVQUF3RCxFQUFFLEVBQzFELE9BQWdDLEVBQUUsRUFDbEMsU0FBaUIsb0JBQVEsQ0FBQyxPQUFPO1FBRWpDLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUM7WUFDN0IsT0FBTztZQUNQLGFBQWEsRUFBRSxPQUFPLENBQUMsYUFBYSxJQUFJLElBQUk7WUFDNUMsSUFBSTtZQUNKLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTyxJQUFJLElBQUk7U0FDakMsQ0FBQyxDQUFDO1FBRUgscURBQXFEO1FBQ3JELE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQ3RCLFVBQVUsRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxHQUFHLEVBQUUsU0FBUyxFQUFFLE9BQU8sQ0FDbkUsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQUVRLHdDQUFjIn0=