const Redis = require("../lib/index");
const { EventEmitter } = require("events");
const promClient = require("prom-client");

const emitter = new EventEmitter();
emitter.on("log", console.log.bind(console));
emitter.on("success", console.log.bind(console));
emitter.on("error", console.error.bind(console));

async function doSome(client) {
  for (let i = 0; i < 1000; i += 1) {
    console.log(i);
    // add timeout of 1s
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      await client.set(`Key:${i}`, i);
    } catch (err) {
      console.log(err);
    }
  }
}

async function doPPL(redis) {
  await redis.ppl([
    {
      command: "hset",
      args: ["Map", "one", "1"],
    },
    {
      command: "hmset",
      args: ["Map", { two: 2, three: 3 }],
    },
    {
      command: "set",
      args: ["count", "3"],
    },
  ]);
  const response = await redis.ppl([
    {
      command: "hgetall",
      args: ["Map"],
    },
    {
      command: "get",
      args: ["count"],
      action(val) {
        return {
          count: val,
        };
      },
    },
  ]);
  console.log(JSON.stringify(response, null, 2));
}

const redis = new Redis(
  "redis",
  emitter,
  {
    host: "127.0.0.1",
    port: 6379,
    commandTimeout: 100,
  },
  {
    register: promClient.register,
    labels: {
      service: "test-test_test9",
    },
  }
);
redis
  .init()
  .then(() => {
    const client = redis.client;
    return doSome(client);
  })
  .then(() => {
    return doPPL(redis);
  })
  .then(() => {
    console.log("Started");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
