import IoRedis from "ioredis";
import EventEmitter from "events";

function retryStrategy(times: number): number {
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
  } else {
    Object.assign(info, {
      authentication: "FALSE",
    });
  }
}

interface RedisConfig {
  host?: string;
  port?: number;
  db?: number;
  autoPipelining?: boolean;
  auth?: { use: boolean; password: string };
  cluster?: {
    use: boolean;
    hosts: { host: string; port: number }[];
    autoPipelining?: boolean;
  };
  sentinel?: {
    use: boolean;
    hosts: { host: string; port: number }[];
    name: string;
    autoPipelining?: boolean;
  };
}

/**
 * @class Redis
 */
class Redis {
  name: string;
  emitter: EventEmitter;
  config: RedisConfig;
  client: IoRedis.Cluster | IoRedis.Redis;

  /**
   * @param {string} name - unique name to this service
   * @param {EventEmitter} emitter
   * @param {RedisConfig} config - configuration object of service
   */
  constructor(name: string, emitter: EventEmitter, config: RedisConfig) {
    this.name = name;
    this.emitter = emitter;
    this.config = Object.assign(
      {
        host: "localhost",
        port: 6379,
        db: 0,
      },
      config,
      {
        auth: Object.assign(
          {
            use: false,
          },
          config.auth
        ),
        cluster: Object.assign(
          {
            use: false,
          },
          config.cluster
        ),
        sentinel: Object.assign(
          {
            use: false,
          },
          config.sentinel
        ),
      }
    );
    this.client = null;
  }

  log(message: string, data: unknown): void {
    this.emitter.emit("log", {
      service: this.name,
      message,
      data,
    });
  }

  success(message: string, data: unknown): void {
    this.emitter.emit("success", {
      service: this.name,
      message,
      data,
    });
  }

  error(err: Error, data: unknown): void {
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
  init(): Promise<Redis> {
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
        client = new IoRedis.Cluster(config.cluster.hosts, clusterOptions);

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
      } else if (sentinel.use === true) {
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
        client = new IoRedis(options);
      } else {
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
        client = new IoRedis(options);
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
        this.log(
          `Reconnecting in ${infoObj.mode} mode after ${time} ms`,
          infoObj
        );
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

  ppl(arr: any[]): Promise<any> {
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

export = Redis;
