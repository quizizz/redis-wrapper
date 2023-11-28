# redis-wrapper

## Description

This repository contains a node/TS wrapper which simplifies the process of communication with Redis.

## How do I Use It?

Install a specific or the latest release in your `package.json` dependencies:

```json
"@quizizz/redis": "github:quizizz/redis-wrapper#0.3.3"
```

Import and use in your code as follows:

```js
import Redis from "@quizizz/redis";

const eventEmitter = new EventEmitter();
const config = {...};

const redisClient = new Redis("redis", eventEmitter, config);
```

## How do I contribute?

We work based on releases. Steps:

- Branch out from `main`
  - Label the branch accordingly - `chore/...`, `feat/...`, `fix/...`
- Make a PR to `main` once done & tested
- Once approved and merged, create a new release from the `main` branch following the SEMVER approach to versioning
