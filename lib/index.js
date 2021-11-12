"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const ioredis_1 = __importDefault(require("ioredis"));
function retryStrategy(times) {
    if (times > 1000) {
        // eslint-disable-next-line no-console
        console.error('Retried redis connection 10 times');
        return null;
    }
    const delay = Math.min(times * 100, 2000);
    return delay;
}
function addAuth(auth, options, info) {
    if (auth.use === true) {
        Object.assign(info, {
            authentication: 'TRUE',
        });
        options.password = auth.password;
    }
    else {
        Object.assign(info, {
            authentication: 'FALSE',
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
     * @param {Object} config - configuration object of service
     */
    constructor(name, emitter, config) {
        this.name = name;
        this.emitter = emitter;
        this.config = Object.assign({
            host: 'localhost',
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
        this.emitter.emit('log', {
            service: this.name,
            message,
            data,
        });
    }
    success(message, data) {
        this.emitter.emit('success', {
            service: this.name, message, data,
        });
    }
    error(err, data) {
        this.emitter.emit('error', {
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
                    mode: 'CLUSTER',
                    hosts: cluster.hosts,
                });
                const clusterOptions = {
                    enableAutoPipelining: cluster.autoPipelining || false,
                    clusterRetryStrategy: retryStrategy,
                };
                addAuth(auth, clusterOptions, infoObj);
                client = new ioredis_1.default.Cluster(config.cluster.hosts, clusterOptions);
                // cluster specific events
                client.on('node error', (err) => {
                    this.error(err, {
                        type: 'node error',
                    });
                });
                client.on('+node', (node) => {
                    const message = `node added ${node.options.key}`;
                    this.log(message, {
                        key: node.options.key,
                    });
                });
                client.on('-node', (node) => {
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
                    mode: 'SENTINEL',
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
                };
                addAuth(auth, options, infoObj);
                client = new ioredis_1.default(options);
            }
            else {
                // single node
                Object.assign(infoObj, {
                    mode: 'SINGLE',
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
                };
                addAuth(auth, options, infoObj);
                client = new ioredis_1.default(options);
                // single node finish
            }
            this.log(`Connecting in ${infoObj.mode} mode`, infoObj);
            // common events
            client.on('connect', () => {
                this.success(`Successfully connected in ${infoObj.mode} mode`, null);
            });
            client.on('error', (err) => {
                this.error(err, {});
            });
            client.on('ready', () => {
                this.client = client;
                resolve(this);
            });
            client.on('close', () => {
                const error = new Error('Redis connection closed');
                this.error(error, null);
            });
            client.on('reconnecting', (time) => {
                this.log(`Reconnecting in ${infoObj.mode} mode after ${time} ms`, infoObj);
            });
            client.on('end', () => {
                this.error(new Error('Connection ended'), null);
            });
        });
    }
    /**
     * Parse the results of multi and pipeline operations from redis
     * Because of the way IoRedis handles them and return responses
     */
    parse(result) {
        result.forEach((res) => {
            if (res[0]) {
                throw new Error(`${res[0]} - redis.multi`);
            }
        });
        return result.map(res => res[1]);
    }
    ppl(arr) {
        const batch = this.client.pipeline();
        arr.forEach(val => {
            batch[val.command](...val.args);
        });
        return batch.exec().then(response => {
            const result = this.parse(response);
            return result.map((res, index) => {
                const action = arr[index].action || (x => x);
                return action(res);
            });
        });
    }
}
module.exports = Redis;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7OztBQUNBLHNEQUE4QjtBQUk5QixTQUFTLGFBQWEsQ0FBQyxLQUFLO0lBQzFCLElBQUksS0FBSyxHQUFHLElBQUksRUFBRTtRQUNoQixzQ0FBc0M7UUFDdEMsT0FBTyxDQUFDLEtBQUssQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFDO1FBQ25ELE9BQU8sSUFBSSxDQUFDO0tBQ2I7SUFDRCxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssR0FBRyxHQUFHLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDMUMsT0FBTyxLQUFLLENBQUM7QUFDZixDQUFDO0FBR0QsU0FBUyxPQUFPLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxJQUFJO0lBQ2xDLElBQUksSUFBSSxDQUFDLEdBQUcsS0FBSyxJQUFJLEVBQUU7UUFDckIsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUU7WUFDbEIsY0FBYyxFQUFFLE1BQU07U0FDdkIsQ0FBQyxDQUFDO1FBQ0gsT0FBTyxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDO0tBQ2xDO1NBQU07UUFDTCxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRTtZQUNsQixjQUFjLEVBQUUsT0FBTztTQUN4QixDQUFDLENBQUM7S0FDSjtBQUNILENBQUM7QUFFRDs7R0FFRztBQUNILE1BQU0sS0FBSztJQUNULElBQUksQ0FBUztJQUNiLE9BQU8sQ0FBZTtJQUN0QixNQUFNLENBQXNCO0lBQzVCLE1BQU0sQ0FBa0M7SUFFeEM7Ozs7T0FJRztJQUNILFlBQVksSUFBWSxFQUFFLE9BQXFCLEVBQUUsTUFBMkI7UUFDMUUsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7UUFDakIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxDQUFDLE1BQU0sR0FB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