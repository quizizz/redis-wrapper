'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULTS = exports.STREAM_MODE = void 0;
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
    SINGLE: 'single',
    GROUP: 'group',
});
exports.STREAM_MODE = STREAM_MODE;
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
exports.DEFAULTS = DEFAULTS;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uc3RhbnRzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3N0cmVhbXMvY29uc3RhbnRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVksQ0FBQzs7O0FBRWI7Ozs7Ozs7O0dBUUc7QUFDSCxNQUFNLFdBQVcsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDO0lBQ2hDLE1BQU0sRUFBRSxRQUFpQjtJQUN6QixLQUFLLEVBQUUsT0FBZ0I7Q0FDeEIsQ0FBQyxDQUFDO0FBMkJNLGtDQUFXO0FBekJwQiwyRUFBMkU7QUFDM0UsTUFBTSxRQUFRLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQztJQUM3QixRQUFRLEVBQUUsSUFBSTtJQUNkLEtBQUssRUFBRSxHQUFHO0lBQ1YsT0FBTyxFQUFFLEtBQUs7SUFDZCxlQUFlLEVBQUUsS0FBSztJQUN0QixlQUFlLEVBQUUsS0FBSztJQUN0QixTQUFTLEVBQUUsR0FBRztJQUNkLGtCQUFrQixFQUFFLEdBQUc7SUFDdkIsdUJBQXVCLEVBQUUsRUFBRSxHQUFHLElBQUk7Q0FDbkMsQ0FBQyxDQUFDO0FBZW1CLDRCQUFRIn0=