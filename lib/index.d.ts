/// <reference types="node" />
import IoRedis, { Redis as _Redis, Cluster } from "ioredis";
import EventEmitter from "events";
import { Registry, Counter, Histogram } from "prom-client";
interface RedisConfig {
    /** provide host ip/url, default - localhost */
    host?: string;
    /** provide the port number, default - 6379 */
    port?: number;
    /** provide the db number, default - 0 */
    db?: number;
    /** enable auto pipelining, default - false */
    autoPipelining?: boolean;
    /** provide auth if needed */
    auth?: {
        use: boolean;
        password: string;
    };
    /** provide command timeout (not applicable for cluster), default - false */
    commandTimeout?: number;
    /** cluster config */
    cluster?: {
        use: boolean;
        hosts: {
            host: string;
            port: number;
        }[];
        autoPipelining?: boolean;
    };
    /** sentinel config */
    sentinel?: {
        use: boolean;
        hosts: {
            host: string;
            port: number;
        }[];
        name: string;
        autoPipelining?: boolean;
    };
}
/**
 * @class Redis
 */
declare class Redis {
    name: string;
    emitter: EventEmitter;
    config: RedisConfig;
    client: Cluster | _Redis;
    commandTimeout?: number;
    metrics?: {
        register: Registry;
        labels: {
            [key: string]: string;
        };
    };
    trackers?: {
        commands?: Counter;
        errors?: Counter;
        latencies?: Histogram;
    };
    /**
     * @param {string} name - unique name to this service
     * @param {EventEmitter} emitter
     * @param {RedisConfig} config - configuration object of service
     * @param {Registry} metrics - prometheus client
     */
    constructor(name: string, emitter: EventEmitter, config: RedisConfig, metrics?: {
        register: Registry;
        labels: {
            [key: string]: string;
        };
    });
    log(message: string, data: unknown): void;
    success(message: string, data: unknown): void;
    error(err: Error, data: unknown): void;
    makeError(message: string, data: unknown): Error;
    trackCommand(command: string): void;
    trackErrors(command: string, errorMessage: string): void;
    trackLatencies(command: string, startTime: number): void;
    createTimeoutPromise(ms: number, command: string): {
        timeoutPromise: Promise<unknown>;
        clear: () => void;
    };
    executeCommand(target: any, prop: any, args: any): Promise<unknown>;
    makeProxy(client: Cluster | _Redis): Cluster | IoRedis;
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
