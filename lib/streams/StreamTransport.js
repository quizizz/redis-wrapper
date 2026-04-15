'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamTransport = void 0;
const constants_1 = require("./constants");
const NOOP_EMITTER = { emit() { } };
/**
 * Unified transport that routes between a legacy broker (RabbitMQ etc.) and Redis Streams,
 * based on a caller-provided routing function.
 *
 * Broker-agnostic - the broker just needs `.send()` and `.subscribe()`.
 *
 * @example
 *   const transport = new StreamTransport({
 *     broker: rabbitClient,
 *     streamProducer: producer,
 *     streamConsumer: consumer,
 *     streamConfigs: [
 *       { topic: 'broadcast', streamMode: STREAM_MODE.GROUP, group: 'cg:app', consumer: podId },
 *       { topic: `reply-${podId}`, streamMode: STREAM_MODE.SINGLE, ttlSeconds: 300 },
 *     ],
 *     shouldUseStreams: (apiName) => featureFlags.isWhitelisted(apiName),
 *     emitter,
 *   });
 */
class StreamTransport {
    _broker;
    _streamProducer;
    _streamConsumer;
    _shouldUseStreamsFn;
    _emitter;
    _streamConfigMap;
    _brokerResults;
    constructor(options) {
        this._broker = options.broker;
        this._streamProducer = options.streamProducer || null;
        this._streamConsumer = options.streamConsumer || null;
        this._shouldUseStreamsFn = options.shouldUseStreams || (() => false);
        this._emitter = options.emitter || NOOP_EMITTER;
        this._streamConfigMap = new Map((options.streamConfigs || []).map((c) => [c.topic, c]));
        this._brokerResults = {};
    }
    // -- Send ---------------------------------------------------------------
    /**
     * Drop-in replacement for broker.send(topic, content, options, meta).
     * Routes via shouldUseStreams() based on the API name extracted from content.
     */
    send(topic, content, options = {}, meta = {}) {
        const apiName = content?.api || content?.broadcast?.api || content?.type || '';
        if (this._streamProducer && this._shouldUseStreamsFn(apiName)) {
            return this._streamProducer.send(`stream:${topic}`, content, options, meta);
        }
        return this._broker.send(topic, content, options, meta);
    }
    // -- Subscribe ----------------------------------------------------------
    /**
     * Subscribe to both broker AND Redis Streams for a given topic.
     * Consumer pattern (XREAD vs XREADGROUP) is resolved from streamConfigs.
     */
    async subscribe(topic, handler) {
        const brokerResult = await this._broker.subscribe(topic, handler);
        this._brokerResults[topic] = brokerResult;
        if (this._streamConsumer) {
            const cfg = this._streamConfigMap.get(topic);
            const streamOpts = cfg?.streamMode === constants_1.STREAM_MODE.GROUP
                ? { group: cfg.group, consumer: cfg.consumer }
                : { ttlSeconds: cfg?.ttlSeconds };
            this._streamConsumer.subscribe(`stream:${topic}`, handler, streamOpts);
        }
    }
    // -- Unsubscribe --------------------------------------------------------
    async unsubscribe(topic) {
        const result = this._brokerResults[topic];
        if (result) {
            await this._broker.unsubscribe(topic, result.consumerTag);
            delete this._brokerResults[topic];
        }
    }
    async stopStreams() {
        if (this._streamConsumer) {
            await this._streamConsumer.stop();
        }
    }
}
exports.StreamTransport = StreamTransport;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU3RyZWFtVHJhbnNwb3J0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3N0cmVhbXMvU3RyZWFtVHJhbnNwb3J0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVksQ0FBQzs7O0FBR2IsMkNBQXdEO0FBSXhELE1BQU0sWUFBWSxHQUFHLEVBQUUsSUFBSSxLQUFJLENBQUMsRUFBNkIsQ0FBQztBQWlCOUQ7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQWtCRztBQUNILE1BQU0sZUFBZTtJQUNYLE9BQU8sQ0FBUztJQUNoQixlQUFlLENBQXdCO0lBQ3ZDLGVBQWUsQ0FBd0I7SUFDdkMsbUJBQW1CLENBQStCO0lBQ2xELFFBQVEsQ0FBZTtJQUN2QixnQkFBZ0IsQ0FBNEI7SUFDNUMsY0FBYyxDQUFzQjtJQUU1QyxZQUFZLE9BQStCO1FBQ3pDLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQztRQUM5QixJQUFJLENBQUMsZUFBZSxHQUFHLE9BQU8sQ0FBQyxjQUFjLElBQUksSUFBSSxDQUFDO1FBQ3RELElBQUksQ0FBQyxlQUFlLEdBQUcsT0FBTyxDQUFDLGNBQWMsSUFBSSxJQUFJLENBQUM7UUFDdEQsSUFBSSxDQUFDLG1CQUFtQixHQUFHLE9BQU8sQ0FBQyxnQkFBZ0IsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ3JFLElBQUksQ0FBQyxRQUFRLEdBQUcsT0FBTyxDQUFDLE9BQU8sSUFBSSxZQUFZLENBQUM7UUFFaEQsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksR0FBRyxDQUM3QixDQUFDLE9BQU8sQ0FBQyxhQUFhLElBQUksRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FDdkQsQ0FBQztRQUNGLElBQUksQ0FBQyxjQUFjLEdBQUcsRUFBRSxDQUFDO0lBQzNCLENBQUM7SUFFRCwwRUFBMEU7SUFFMUU7OztPQUdHO0lBQ0gsSUFBSSxDQUFDLEtBQWEsRUFBRSxPQUFZLEVBQUUsVUFBZSxFQUFFLEVBQUUsT0FBWSxFQUFFO1FBQ2pFLE1BQU0sT0FBTyxHQUFHLE9BQU8sRUFBRSxHQUFHLElBQUksT0FBTyxFQUFFLFNBQVMsRUFBRSxHQUFHLElBQUksT0FBTyxFQUFFLElBQUksSUFBSSxFQUFFLENBQUM7UUFFL0UsSUFBSSxJQUFJLENBQUMsZUFBZSxJQUFJLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxPQUFPLENBQUMsRUFBRTtZQUM3RCxPQUFPLElBQUksQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLFVBQVUsS0FBSyxFQUFFLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxJQUFJLENBQUMsQ0FBQztTQUM3RTtRQUNELE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDMUQsQ0FBQztJQUVELDBFQUEwRTtJQUUxRTs7O09BR0c7SUFDSCxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQWEsRUFBRSxPQUFvQztRQUNqRSxNQUFNLFlBQVksR0FBRyxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztRQUNsRSxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxHQUFHLFlBQVksQ0FBQztRQUUxQyxJQUFJLElBQUksQ0FBQyxlQUFlLEVBQUU7WUFDeEIsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUM3QyxNQUFNLFVBQVUsR0FBRyxHQUFHLEVBQUUsVUFBVSxLQUFLLHVCQUFXLENBQUMsS0FBSztnQkFDdEQsQ0FBQyxDQUFDLEVBQUUsS0FBSyxFQUFFLEdBQUcsQ0FBQyxLQUFLLEVBQUUsUUFBUSxFQUFFLEdBQUcsQ0FBQyxRQUFRLEVBQUU7Z0JBQzlDLENBQUMsQ0FBQyxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUsVUFBVSxFQUFFLENBQUM7WUFDcEMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxTQUFTLENBQUMsVUFBVSxLQUFLLEVBQUUsRUFBRSxPQUFPLEVBQUUsVUFBVSxDQUFDLENBQUM7U0FDeEU7SUFDSCxDQUFDO0lBRUQsMEVBQTBFO0lBRTFFLEtBQUssQ0FBQyxXQUFXLENBQUMsS0FBYTtRQUM3QixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzFDLElBQUksTUFBTSxFQUFFO1lBQ1YsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1lBQzFELE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsQ0FBQztTQUNuQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsV0FBVztRQUNmLElBQUksSUFBSSxDQUFDLGVBQWUsRUFBRTtZQUN4QixNQUFNLElBQUksQ0FBQyxlQUFlLENBQUMsSUFBSSxFQUFFLENBQUM7U0FDbkM7SUFDSCxDQUFDO0NBQ0Y7QUFFUSwwQ0FBZSJ9