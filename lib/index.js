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
        if (this.metrics) {
            // register counters
            this.trackers = {};
            // create counter for tracking the number of times redis commands are called
            this.trackers.commands = new prom_client_1.Counter({
                name: `${this.name}_commands`,
                help: "keep track of all redis commands",
                labelNames: [...Object.keys(this.metrics.labels), "command"],
                registers: [this.metrics.register],
            });
            // create counter for tracking the number of times redis commands have failed
            this.trackers.errors = new prom_client_1.Counter({
                name: `${this.name}_errors`,
                help: "keep track of all redis command errors",
                labelNames: [
                    ...Object.keys(this.metrics.labels),
                    "command",
                    "errorMessage",
                ],
                registers: [this.metrics.register],
            });
            // create histogram for tracking latencies of redis commands
            this.trackers.latencies = new prom_client_1.Histogram({
                name: `${this.name}_latencies`,
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
    trackCommand(command) {
        if (this.trackers?.commands) {
            this.trackers.commands.inc({
                ...this.metrics.labels,
                command,
            }, 1);
        }
    }
    trackErrors(command, errorMessage) {
        if (this.trackers?.errors) {
            this.trackers.errors.inc({
                ...this.metrics.labels,
                command,
                errorMessage,
            }, 1);
        }
    }
    trackLatencies(command, startTime) {
        if (this.trackers?.latencies) {
            const endTime = perf_hooks_1.performance.now();
            this.trackers.latencies.observe({
                ...this.metrics.labels,
                command,
            }, endTime - startTime);
        }
    }
    createTimeoutPromise(ms, command) {
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(this.makeError("redis.COMMAND_TIMEOUT", {
                    command,
                    timeout: ms,
                }));
            }, ms);
        });
        return {
            timeoutPromise,
            clear: () => {
                clearTimeout(timeoutId);
            },
        };
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
                    return async (...args) => {
                        const startTime = perf_hooks_1.performance.now();
                        try {
                            this.trackCommand(String(prop));
                            let result;
                            // check if cluster and command timeout is set
                            if (this.client.isCluster && this.commandTimeout) {
                                const { timeoutPromise, clear } = this.createTimeoutPromise(this.commandTimeout, String(prop));
                                result = await Promise.race([
                                    target[prop](...args),
                                    timeoutPromise,
                                ]).finally(() => {
                                    clear();
                                });
                            }
                            else {
                                result = await target[prop](...args);
                            }
                            this.trackLatencies(String(prop), startTime);
                            return result;
                        }
                        catch (err) {
                            this.trackLatencies(String(prop), startTime);
                            this.trackErrors(String(prop), err.message);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsbURBS2lCO0FBRWpCLGdEQUF3RDtBQUN4RCw2Q0FBMkQ7QUFDM0QsMkNBQXlDO0FBRXpDLFNBQVMsYUFBYSxDQUFDLEtBQWE7SUFDbEMsSUFBSSxLQUFLLEdBQUcsSUFBSSxFQUFFO1FBQ2hCLHNDQUFzQztRQUN0QyxPQUFPLENBQUMsS0FBSyxDQUFDLG1EQUFtRCxDQUFDLENBQUM7UUFDbkUsT0FBTyxJQUFJLENBQUM7S0FDYjtJQUNELE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxHQUFHLEdBQUcsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDLDRFQUE0RTtJQUN2SCxPQUFPLEtBQUssQ0FBQztBQUNmLENBQUM7QUFFRCxTQUFTLE9BQU8sQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLElBQUk7SUFDbEMsSUFBSSxJQUFJLENBQUMsR0FBRyxLQUFLLElBQUksRUFBRTtRQUNyQixNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRTtZQUNsQixjQUFjLEVBQUUsTUFBTTtTQUN2QixDQUFDLENBQUM7UUFDSCxPQUFPLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUM7S0FDbEM7U0FBTTtRQUNMLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFO1lBQ2xCLGNBQWMsRUFBRSxPQUFPO1NBQ3hCLENBQUMsQ0FBQztLQUNKO0FBQ0gsQ0FBQztBQWdDRDs7R0FFRztBQUNILE1BQU0sS0FBSztJQUNULElBQUksQ0FBUztJQUNiLE9BQU8sQ0FBZTtJQUN0QixNQUFNLENBQWM7SUFDcEIsTUFBTSxDQUFtQjtJQUN6QixjQUFjLENBQVU7SUFDeEIsT0FBTyxDQUdMO0lBQ0YsUUFBUSxDQUFtRTtJQUUzRTs7Ozs7T0FLRztJQUNILFlBQ0UsSUFB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