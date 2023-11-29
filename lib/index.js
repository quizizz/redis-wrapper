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
                name: `${this.name.replaceAll("-", "_")}:commands`,
                help: "keep track of all redis commands",
                labelNames: [...Object.keys(this.metrics.labels), "command"],
                registers: [this.metrics.register],
            });
            // create counter for tracking the number of times redis commands have failed
            this.trackers.errors = new prom_client_1.Counter({
                name: `${this.name.replaceAll("-", "_")}:errors`,
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
                name: `${this.name.replaceAll("-", "_")}:latencies`,
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
    async executeCommand(target, prop, args) {
        const startTime = perf_hooks_1.performance.now();
        try {
            this.trackCommand(String(prop));
            const result = await target[prop](...args);
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
    }
    makeProxy(client) {
        return new Proxy(client, {
            get: (target, prop) => {
                // check if a command or not
                if (!(0, commands_1.exists)(String(prop))) {
                    return target[prop];
                }
                // check if client in ready state
                if (this.client.status !== "ready") {
                    throw this.makeError("redis.NOT_READY", {
                        command: prop,
                    });
                }
                return (...args) => {
                    // If timeout is set, apply Promise.race
                    if (this.client.isCluster && this.commandTimeout) {
                        const { timeoutPromise, clear } = this.createTimeoutPromise(this.commandTimeout, String(prop));
                        return Promise.race([
                            this.executeCommand(target, prop, args),
                            timeoutPromise,
                        ]).finally(clear);
                    }
                    else {
                        return this.executeCommand(target, prop, args);
                    }
                };
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