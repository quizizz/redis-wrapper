/// <reference types="node" />
import EventEmitter from 'events';
import { StreamConfig } from './constants';
import { StreamProducer } from './StreamProducer';
import { StreamConsumer } from './StreamConsumer';
interface Broker {
    send(topic: string, content: any, options?: any, meta?: any): any;
    subscribe(topic: string, handler: (msg: any) => Promise<void>): Promise<any>;
    unsubscribe(topic: string, consumerTag: string): Promise<void>;
}
interface StreamTransportOptions {
    broker: Broker;
    streamProducer?: StreamProducer | null;
    streamConsumer?: StreamConsumer | null;
    streamConfigs?: StreamConfig[];
    shouldUseStreams?: (apiName: string) => boolean;
    emitter?: EventEmitter;
}
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
declare class StreamTransport {
    private _broker;
    private _streamProducer;
    private _streamConsumer;
    private _shouldUseStreamsFn;
    private _emitter;
    private _streamConfigMap;
    private _brokerResults;
    constructor(options: StreamTransportOptions);
    /**
     * Drop-in replacement for broker.send(topic, content, options, meta).
     * Routes via shouldUseStreams() based on the API name extracted from content.
     */
    send(topic: string, content: any, options?: any, meta?: any): any;
    /**
     * Subscribe to both broker AND Redis Streams for a given topic.
     * Consumer pattern (XREAD vs XREADGROUP) is resolved from streamConfigs.
     */
    subscribe(topic: string, handler: (msg: any) => Promise<void>): Promise<void>;
    unsubscribe(topic: string): Promise<void>;
    stopStreams(): Promise<void>;
}
export { StreamTransport };
