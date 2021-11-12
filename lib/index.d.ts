/// <reference types="node" />
import IoRedis from 'ioredis';
import EventEmitter from 'events';
/**
 * @class Redis
 */
declare class Redis {
    name: string;
    emitter: EventEmitter;
    config: Record<string, any>;
    client: IoRedis.Cluster | IoRedis.Redis;
    /**
     * @param {string} name - unique name to this service
     * @param {EventEmitter} emitter
     * @param {Object} config - configuration object of service
     */
    constructor(name: string, emitter: EventEmitter, config: Record<string, any>);
    log(message: string, data: unknown): void;
    success(message: string, data: unknown): void;
    error(err: Error, data: unknown): void;
    /**
     * Connect to redis server with the config
     *
     * @return {Promise<this, Error>} resolves with the instance itself
     *  rejects when can not connect after retires
     */
    init(): Promise<Redis>;
    /**
     * Parse the results of multi and pipeline operations from redis
     * Because of the way IoRedis handles them and return responses
     */
    parse(result: any): any;
    ppl(arr: any[]): Promise<any>;
}
export = Redis;
