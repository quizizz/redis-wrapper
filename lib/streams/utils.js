'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStreamGroups = void 0;
const constants_1 = require("./constants");
/**
 * Create consumer groups for all GROUP-mode streams.
 * Idempotent - ignores BUSYGROUP if the group already exists.
 */
async function createStreamGroups(configs, redisClient) {
    for (const cfg of configs) {
        if (cfg.streamMode !== constants_1.STREAM_MODE.GROUP)
            continue;
        try {
            // ioredis: XGROUP CREATE key group id MKSTREAM
            await redisClient.xgroup('CREATE', `stream:${cfg.topic}`, cfg.group, '$', 'MKSTREAM');
        }
        catch (e) {
            if (!e.message?.includes('BUSYGROUP'))
                throw e;
        }
    }
}
exports.createStreamGroups = createStreamGroups;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvc3RyZWFtcy91dGlscy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZLENBQUM7OztBQUdiLDJDQUF3RDtBQUl4RDs7O0dBR0c7QUFDSCxLQUFLLFVBQVUsa0JBQWtCLENBQy9CLE9BQXVCLEVBQ3ZCLFdBQXdCO0lBRXhCLEtBQUssTUFBTSxHQUFHLElBQUksT0FBTyxFQUFFO1FBQ3pCLElBQUksR0FBRyxDQUFDLFVBQVUsS0FBSyx1QkFBVyxDQUFDLEtBQUs7WUFBRSxTQUFTO1FBQ25ELElBQUk7WUFDRiwrQ0FBK0M7WUFDL0MsTUFBTyxXQUFtQixDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsVUFBVSxHQUFHLENBQUMsS0FBSyxFQUFFLEVBQUUsR0FBRyxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUUsVUFBVSxDQUFDLENBQUM7U0FDaEc7UUFBQyxPQUFPLENBQU0sRUFBRTtZQUNmLElBQUksQ0FBQyxDQUFDLENBQUMsT0FBTyxFQUFFLFFBQVEsQ0FBQyxXQUFXLENBQUM7Z0JBQUUsTUFBTSxDQUFDLENBQUM7U0FDaEQ7S0FDRjtBQUNILENBQUM7QUFFUSxnREFBa0IifQ==