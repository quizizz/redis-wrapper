'use strict';

import { Redis, Cluster } from 'ioredis';
import { STREAM_MODE, StreamConfig } from './constants';

type RedisClient = Redis | Cluster;

/**
 * Create consumer groups for all GROUP-mode streams.
 * Idempotent - ignores BUSYGROUP if the group already exists.
 */
async function createStreamGroups(
  configs: StreamConfig[],
  redisClient: RedisClient,
): Promise<void> {
  for (const cfg of configs) {
    if (cfg.streamMode !== STREAM_MODE.GROUP) continue;
    try {
      // ioredis: XGROUP CREATE key group id MKSTREAM
      await (redisClient as any).xgroup('CREATE', `stream:${cfg.topic}`, cfg.group, '$', 'MKSTREAM');
    } catch (e: any) {
      if (!e.message?.includes('BUSYGROUP')) throw e;
    }
  }
}

export { createStreamGroups };
