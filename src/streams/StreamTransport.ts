'use strict';

import EventEmitter from 'events';
import { STREAM_MODE, StreamConfig } from './constants';
import { StreamProducer } from './StreamProducer';
import { StreamConsumer } from './StreamConsumer';

const NOOP_EMITTER = { emit() {} } as unknown as EventEmitter;

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
class StreamTransport {
  private _broker: Broker;
  private _streamProducer: StreamProducer | null;
  private _streamConsumer: StreamConsumer | null;
  private _shouldUseStreamsFn: (apiName: string) => boolean;
  private _emitter: EventEmitter;
  private _streamConfigMap: Map<string, StreamConfig>;
  private _brokerResults: Record<string, any>;

  constructor(options: StreamTransportOptions) {
    this._broker = options.broker;
    this._streamProducer = options.streamProducer || null;
    this._streamConsumer = options.streamConsumer || null;
    this._shouldUseStreamsFn = options.shouldUseStreams || (() => false);
    this._emitter = options.emitter || NOOP_EMITTER;

    this._streamConfigMap = new Map(
      (options.streamConfigs || []).map((c) => [c.topic, c]),
    );
    this._brokerResults = {};
  }

  // -- Send ---------------------------------------------------------------

  /**
   * Drop-in replacement for broker.send(topic, content, options, meta).
   * Routes via shouldUseStreams() based on the API name extracted from content.
   */
  send(topic: string, content: any, options: any = {}, meta: any = {}) {
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
  async subscribe(topic: string, handler: (msg: any) => Promise<void>) {
    const brokerResult = await this._broker.subscribe(topic, handler);
    this._brokerResults[topic] = brokerResult;

    if (this._streamConsumer) {
      const cfg = this._streamConfigMap.get(topic);
      const streamOpts = cfg?.streamMode === STREAM_MODE.GROUP
        ? { group: cfg.group, consumer: cfg.consumer }
        : { ttlSeconds: cfg?.ttlSeconds };
      this._streamConsumer.subscribe(`stream:${topic}`, handler, streamOpts);
    }
  }

  // -- Unsubscribe --------------------------------------------------------

  async unsubscribe(topic: string) {
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

export { StreamTransport };
