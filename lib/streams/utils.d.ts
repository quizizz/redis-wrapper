import { Redis, Cluster } from 'ioredis';
import { StreamConfig } from './constants';
type RedisClient = Redis | Cluster;
/**
 * Create consumer groups for all GROUP-mode streams.
 * Idempotent - ignores BUSYGROUP if the group already exists.
 */
declare function createStreamGroups(configs: StreamConfig[], redisClient: RedisClient): Promise<void>;
export { createStreamGroups };
