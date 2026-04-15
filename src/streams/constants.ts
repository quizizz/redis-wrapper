'use strict';

/**
 * Consumer patterns for Redis Streams.
 *
 *   SINGLE - XREAD, no consumer group. One pod reads from the stream.
 *            Supports autoDelete via EXPIRE (ttlSeconds).
 *
 *   GROUP  - XREADGROUP with a consumer group. Multiple pods compete.
 *            Requires the group to be created before first use (see createStreamGroups).
 */
const STREAM_MODE = Object.freeze({
  SINGLE: 'single' as const,
  GROUP: 'group' as const,
});

/** Tunable defaults. Override per-call or per-subscription via options. */
const DEFAULTS = Object.freeze({
  BLOCK_MS: 5000,
  COUNT: 100,
  MAX_LEN: 10000,
  PEL_INTERVAL_MS: 30000,
  PEL_MIN_IDLE_MS: 60000,
  PEL_COUNT: 100,
  STREAM_TTL_SECONDS: 300,
  TTL_REFRESH_INTERVAL_MS: 60 * 1000,
});

export interface StreamConfig {
  /** base name (no 'stream:' prefix) */
  topic: string;
  /** STREAM_MODE.SINGLE | STREAM_MODE.GROUP */
  streamMode: string;
  /** consumer group name (GROUP mode only) */
  group?: string;
  /** consumer name within group (GROUP mode only) */
  consumer?: string;
  /** EXPIRE TTL for autoDelete (SINGLE mode, default 300) */
  ttlSeconds?: number;
}

export { STREAM_MODE, DEFAULTS };
