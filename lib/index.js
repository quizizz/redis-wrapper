"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const ioredis_1 = __importDefault(require("ioredis"));
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
    /**
     * @param {string} name - unique name to this service
     * @param {EventEmitter} emitter
     * @param {RedisConfig} config - configuration object of service
     */
    constructor(name, emitter, config) {
        this.name = name;
        this.emitter = emitter;
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
            const { host, port, db, cluster, sentinel, auth } = config;
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
                client = new ioredis_1.default.Cluster(config.cluster.hosts, clusterOptions);
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
                addAuth(auth, options, infoObj);
                client = new ioredis_1.default(options);
                // single node finish
            }
            this.log(`Connecting in ${infoObj.mode} mode`, infoObj);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7OztBQUFBLHNEQUE4QjtBQUc5QixTQUFTLGFBQWEsQ0FBQyxLQUFhO0lBQ2xDLElBQUksS0FBSyxHQUFHLElBQUksRUFBRTtRQUNoQixzQ0FBc0M7UUFDdEMsT0FBTyxDQUFDLEtBQUssQ0FBQyxtREFBbUQsQ0FBQyxDQUFDO1FBQ25FLE9BQU8sSUFBSSxDQUFDO0tBQ2I7SUFDRCxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssR0FBRyxHQUFHLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQyw0RUFBNEU7SUFDdkgsT0FBTyxLQUFLLENBQUM7QUFDZixDQUFDO0FBRUQsU0FBUyxPQUFPLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxJQUFJO0lBQ2xDLElBQUksSUFBSSxDQUFDLEdBQUcsS0FBSyxJQUFJLEVBQUU7UUFDckIsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUU7WUFDbEIsY0FBYyxFQUFFLE1BQU07U0FDdkIsQ0FBQyxDQUFDO1FBQ0gsT0FBTyxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDO0tBQ2xDO1NBQU07UUFDTCxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRTtZQUNsQixjQUFjLEVBQUUsT0FBTztTQUN4QixDQUFDLENBQUM7S0FDSjtBQUNILENBQUM7QUFxQkQ7O0dBRUc7QUFDSCxNQUFNLEtBQUs7SUFDVCxJQUFJLENBQVM7SUFDYixPQUFPLENBQWU7SUFDdEIsTUFBTSxDQUFjO0lBQ3BCLE1BQU0sQ0FBa0M7SUFFeEM7Ozs7T0FJRztJQUNILFlBQVksSUFBWSxFQUFFLE9BQXFCLEVBQUUsTUFBbUI7UUFDbEUsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7UUFDakIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxD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