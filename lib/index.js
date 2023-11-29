"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
const ioredis_1 = __importStar(require("ioredis"));
const commands_1 = require("@ioredis/commands");
const prom_client_1 = require("prom-client");
const perf_hooks_1 = require("perf_hooks");
function retryStrategy(times) {
    if (times > 1000) {
        // eslint-disable-next-line no-console
        console.error("Retried redis connection 1000 times, stopping now");
        return null;
    }
    const delay = Math.min(times * 100, 2000); // exponential backoff with a factor of an extra 100ms and a max delay of 2s
    return delay;
}
function addAuth(auth, options, info) {
    if (auth.use === true) {
        Object.assign(info, {
            authentication: "TRUE",
        });
        options.password = auth.password;
    }
    else {
        Object.assign(info, {
            authentication: "FALSE",
        });
    }
}
/**
 * @class Redis
 */
class Redis {
    name;
    emitter;
    config;
    client;
    commandTimeout;
    metrics;
    trackers;
    /**
     * @param {string} name - unique name to this service
     * @param {EventEmitter} emitter
     * @param {RedisConfig} config - configuration object of service
     * @param {Registry} metrics - prometheus client
     */
    constructor(name, emitter, config, metrics) {
        this.name = name;
        this.emitter = emitter;
        this.commandTimeout = config.commandTimeout;
        this.metrics = metrics;
        this.trackers = {};
        if (this.metrics) {
            // register counters
            // create counter for tracking the number of times redis commands are called
            this.trackers["commands"] = new prom_client_1.Counter({
                name: "redis_command_counter",
                help: "keep track of all redis commands",
                labelNames: [...Object.keys(this.metrics.labels), "command"],
                registers: [this.metrics.register],
            });
            // create counter for tracking the number of times redis commands have failed
            this.trackers["errors"] = new prom_client_1.Counter({
                name: "redis_command_error_counter",
                help: "keep track of all redis command errors",
                labelNames: [...Object.keys(this.metrics.labels), "command"],
                registers: [this.metrics.register],
            });
            // create histogram for tracking latencies of redis commands
            this.trackers["latencies"] = new prom_client_1.Histogram({
                name: "redis_command_latency",
                help: "keep track of redis command latencies",
                labelNames: [...Object.keys(this.metrics.labels), "command"],
                registers: [this.metrics.register],
            });
        }
        this.config = Object.assign({
            host: "localhost",
            port: 6379,
            db: 0,
        }, config, {
            auth: Object.assign({
                use: false,
            }, config.auth),
            cluster: Object.assign({
                use: false,
            }, config.cluster),
            sentinel: Object.assign({
                use: false,
            }, config.sentinel),
        });
        this.client = null;
    }
    log(message, data) {
        this.emitter.emit("log", {
            service: this.name,
            message,
            data,
        });
    }
    success(message, data) {
        this.emitter.emit("success", {
            service: this.name,
            message,
            data,
        });
    }
    error(err, data) {
        this.emitter.emit("error", {
            service: this.name,
            data,
            err,
        });
    }
    makeError(message, data) {
        const error = new Error(message);
        this.error(error, data);
        return error;
    }
    makeProxy(client) {
        return new Proxy(client, {
            get: (target, prop) => {
                if ((0, commands_1.exists)(String(prop))) {
                    // check if client in ready state
                    if (this.client.status !== "ready") {
                        throw this.makeError("redis.NOT_READY", {
                            command: prop,
                        });
                    }
                    // check if cluster and command timeout is set
                    let promiseTimeout;
                    if (this.client.isCluster && this.commandTimeout) {
                        promiseTimeout = (ms) => new Promise((_, reject) => setTimeout(() => {
                            reject(this.makeError("redis.COMMAND_TIMEOUT", {
                                command: prop,
                                timeout: ms,
                            }));
                        }, ms));
                    }
                    return async (...args) => {
                        const startTime = perf_hooks_1.performance.now();
                        try {
                            const promises = [];
                            promises.push(target[prop](...args));
                            this.trackers["commands"]?.inc({
                                ...this.metrics.labels,
                                command: String(prop),
                            }, 1);
                            if (promiseTimeout) {
                                promises.push(promiseTimeout(this.commandTimeout));
                            }
                            const result = await Promise.race(promises);
                            const endTime = perf_hooks_1.performance.now();
                            this.trackers["latencies"]?.observe({
                                ...this.metrics.labels,
                                command: String(prop),
                            }, endTime - startTime);
                            return result;
                        }
                        catch (err) {
                            const endTime = perf_hooks_1.performance.now();
                            this.trackers["latencies"]?.observe({
                                ...this.metrics.labels,
                                command: String(prop),
                            }, endTime - startTime);
                            this.trackers["errors"]?.inc({
                                ...this.metrics.labels,
                                command: String(prop),
                            }, 1);
                            throw this.makeError("redis.COMMAND_ERROR", {
                                command: prop,
                                args,
                                error: err,
                            });
                        }
                    };
                }
                return target[prop];
            },
        });
    }
    /**
     * Connect to redis server with the config
     *
     * @return {Promise<this, Error>} resolves with the instance itself
     *  rejects when can not connect after retires
     */
    init() {
        if (this.client) {
            return Promise.resolve(this);
        }
        // try to make the connection
        return new Promise((resolve) => {
            let client = null;
            const { config } = this;
            const { host, port, db, cluster, sentinel, auth, commandTimeout } = config;
            const infoObj = {
                mode: null,
            };
            if (cluster.use === true) {
                Object.assign(infoObj, {
                    mode: "CLUSTER",
                    hosts: cluster.hosts,
                });
                const clusterOptions = {
                    enableAutoPipelining: cluster.autoPipelining || false,
                    clusterRetryStrategy: retryStrategy,
                };
                addAuth(auth, clusterOptions, infoObj);
                client = new ioredis_1.Cluster(config.cluster.hosts, clusterOptions);
                // cluster specific events
                client.on("node error", (err) => {
                    this.error(err, {
                        type: "node error",
                    });
                });
                client.on("+node", (node) => {
                    const message = `node added ${node.options.key}`;
                    this.log(message, {
                        key: node.options.key,
                    });
                });
                client.on("-node", (node) => {
                    const error = new Error(`node removed ${node.options.key}`);
                    this.error(error, {
                        key: node.options.key,
                    });
                });
                // cluster finish
            }
            else if (sentinel.use === true) {
                // sentinel mode
                const { hosts, name } = sentinel;
                Object.assign(infoObj, {
                    mode: "SENTINEL",
                    hosts,
                    name,
                });
                const options = {
                    sentinels: hosts,
                    name,
                    db,
                    retryStrategy,
                    reconnectOnError: () => {
                        return true;
                    },
                    enableAutoPipelining: sentinel.autoPipelining || false,
                };
                if (commandTimeout) {
                    options.commandTimeout = commandTimeout;
                }
                addAuth(auth, options, infoObj);
                client = new ioredis_1.default(options);
            }
            else {
                // single node
                Object.assign(infoObj, {
                    mode: "SINGLE",
                    host,
                    port,
                    db,
                });
                const options = {
                    port,
                    host,
                    db,
                    retryStrategy,
                    reconnectOnError: () => {
                        return true;
                    },
                    enableAutoPipelining: config.autoPipelining || false,
                };
                if (commandTimeout) {
                    options.commandTimeout = commandTimeout;
                }
                addAuth(auth, options, infoObj);
                client = new ioredis_1.default(options);
                // single node finish
            }
            this.log(`Connecting in ${infoObj.mode} mode`, infoObj);
            client = this.makeProxy(client);
            // common events
            client.on("connect", () => {
                this.success(`Successfully connected in ${infoObj.mode} mode`, null);
            });
            client.on("error", (err) => {
                this.error(err, {});
            });
            client.on("ready", () => {
                this.client = client;
                resolve(this);
            });
            client.on("close", () => {
                const error = new Error("Redis connection closed");
                this.error(error, null);
            });
            client.on("reconnecting", (time) => {
                this.log(`Reconnecting in ${infoObj.mode} mode after ${time} ms`, infoObj);
            });
            client.on("end", () => {
                this.error(new Error("Connection ended"), null);
            });
        });
    }
    /**
     * Parse the results of multi and pipeline operations from redis
     * Because of the way IoRedis handles them and return responses
     */
    parse(result) {
        // eslint-disable-line
        result.forEach((res) => {
            if (res[0]) {
                throw new Error(`${res[0]} - redis.multi`);
            }
        });
        return result.map((res) => res[1]);
    }
    ppl(arr) {
        const batch = this.client.pipeline();
        arr.forEach((val) => {
            batch[val.command](...val.args);
        });
        return batch.exec().then((response) => {
            const result = this.parse(response);
            return result.map((res, index) => {
                const action = arr[index].action || ((x) => x);
                return action(res);
            });
        });
    }
}
module.exports = Redis;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsbURBS2lCO0FBRWpCLGdEQUF3RDtBQUN4RCw2Q0FBMkQ7QUFDM0QsMkNBQXlDO0FBRXpDLFNBQVMsYUFBYSxDQUFDLEtBQWE7SUFDbEMsSUFBSSxLQUFLLEdBQUcsSUFBSSxFQUFFO1FBQ2hCLHNDQUFzQztRQUN0QyxPQUFPLENBQUMsS0FBSyxDQUFDLG1EQUFtRCxDQUFDLENBQUM7UUFDbkUsT0FBTyxJQUFJLENBQUM7S0FDYjtJQUNELE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxHQUFHLEdBQUcsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDLDRFQUE0RTtJQUN2SCxPQUFPLEtBQUssQ0FBQztBQUNmLENBQUM7QUFFRCxTQUFTLE9BQU8sQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLElBQUk7SUFDbEMsSUFBSSxJQUFJLENBQUMsR0FBRyxLQUFLLElBQUksRUFBRTtRQUNyQixNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRTtZQUNsQixjQUFjLEVBQUUsTUFBTTtTQUN2QixDQUFDLENBQUM7UUFDSCxPQUFPLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUM7S0FDbEM7U0FBTTtRQUNMLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFO1lBQ2xCLGNBQWMsRUFBRSxPQUFPO1NBQ3hCLENBQUMsQ0FBQztLQUNKO0FBQ0gsQ0FBQztBQWdDRDs7R0FFRztBQUNILE1BQU0sS0FBSztJQUNULElBQUksQ0FBUztJQUNiLE9BQU8sQ0FBZTtJQUN0QixNQUFNLENBQWM7SUFDcEIsTUFBTSxDQUFtQjtJQUN6QixjQUFjLENBQVU7SUFDeEIsT0FBTyxDQUdMO0lBQ0YsUUFBUSxDQUEwQztJQUVsRDs7Ozs7T0FLRztJQUNILFlBQ0UsSUFB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