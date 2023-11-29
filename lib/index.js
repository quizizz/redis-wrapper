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
    /**
     * @param {string} name - unique name to this service
     * @param {EventEmitter} emitter
     * @param {RedisConfig} config - configuration object of service
     */
    constructor(name, emitter, config) {
        this.name = name;
        this.emitter = emitter;
        this.commandTimeout = config.commandTimeout;
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
            client = new Proxy(client, {
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
                            try {
                                const promises = [];
                                promises.push(target[prop](...args));
                                if (promiseTimeout) {
                                    promises.push(promiseTimeout(this.commandTimeout));
                                }
                                return await Promise.race(promises);
                            }
                            catch (err) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsbURBS2lCO0FBRWpCLGdEQUF3RDtBQUV4RCxTQUFTLGFBQWEsQ0FBQyxLQUFhO0lBQ2xDLElBQUksS0FBSyxHQUFHLElBQUksRUFBRTtRQUNoQixzQ0FBc0M7UUFDdEMsT0FBTyxDQUFDLEtBQUssQ0FBQyxtREFBbUQsQ0FBQyxDQUFDO1FBQ25FLE9BQU8sSUFBSSxDQUFDO0tBQ2I7SUFDRCxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssR0FBRyxHQUFHLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQyw0RUFBNEU7SUFDdkgsT0FBTyxLQUFLLENBQUM7QUFDZixDQUFDO0FBRUQsU0FBUyxPQUFPLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxJQUFJO0lBQ2xDLElBQUksSUFBSSxDQUFDLEdBQUcsS0FBSyxJQUFJLEVBQUU7UUFDckIsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUU7WUFDbEIsY0FBYyxFQUFFLE1BQU07U0FDdkIsQ0FBQyxDQUFDO1FBQ0gsT0FBTyxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDO0tBQ2xDO1NBQU07UUFDTCxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRTtZQUNsQixjQUFjLEVBQUUsT0FBTztTQUN4QixDQUFDLENBQUM7S0FDSjtBQUNILENBQUM7QUFnQ0Q7O0dBRUc7QUFDSCxNQUFNLEtBQUs7SUFDVCxJQUFJLENBQVM7SUFDYixPQUFPLENBQWU7SUFDdEIsTUFBTSxDQUFjO0lBQ3BCLE1BQU0sQ0FBbUI7SUFDekIsY0FBYyxDQUFVO0lBRXhCOzs7O09BSUc7SUFDSCxZQUFZLElBQVksRUFBRSxPQUFxQixFQUFFLE1BQW1CO1FBQ2xFLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFD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