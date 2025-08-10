import { z } from "zod";

export const EnvSchema = z.enum(["dev", "prod", "test"]);

export const ConfigSchema = z.object({
  env: EnvSchema,

  server: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    wsPath: z.string().min(1),
    restPrefix: z.string().min(1),
    metricsPath: z.string().min(1),
    adminPrefix: z.string().min(1),
    corsOrigins: z.array(z.string()).default(["*"]),
    trustProxy: z.boolean().default(false),
  }),

  simulation: z.object({
    simulationHz: z.number().int().positive(),
    networkSnapshotHz: z.number().int().positive(),
  }),

  aoi: z.object({
    radius: z.number().positive(),
    cellSize: z.number().positive(),
  }),

  snapshot: z.object({
    keyframeIntervalSec: z.number().positive(),
    maxEntitiesPerSnapshot: z.number().int().positive(),
    maxBytesPerSnapshot: z.number().int().positive(),
  }),

  workers: z.object({
    gatewayWorkers: z.number().int().positive(),
    worldWorkers: z.number().int().positive(),
    jobWorkers: z.number().int().nonnegative(),
  }),

  ipc: z.object({
    clientInputSabBytes: z.number().int().positive(),
    clientOutputSabBytes: z.number().int().positive(),
    controlSabBytes: z.number().int().positive(),
  }),

  protocolLimits: z.object({
    maxWsFrameBytes: z.number().int().positive(),
    maxMessageBytes: z.number().int().positive(),
    inputRate: z.object({
      ratePerSec: z.number().int().positive(),
      burst: z.number().int().nonnegative(),
    }),
    maxConnections: z.number().int().positive(),
  }),

  logs: z.object({
    json: z.boolean(),
    pretty: z.boolean(),
    level: z.enum(["debug", "info", "warn", "error"]),
  }),

  metrics: z.object({
    enabled: z.boolean(),
  }),

  tracing: z.object({
    enabled: z.boolean(),
  }),

  flags: z.object({
    path: z.string().min(1),
    hotReload: z.boolean(),
  }),

  auth: z.object({
    jwt: z.object({
      algorithm: z.literal("HS256"),
      secret: z.string().min(1),
      accessTtl: z.string().min(1),
      refreshTtl: z.string().min(1),
    }),
  }),

  worldLimits: z.object({
    softMaxEntitiesPerWorld: z.number().int().positive(),
    softMaxPlayersPerWorld: z.number().int().positive(),
    splitTrigger: z.object({
      p99TickMs: z.number().positive(),
      consecutiveTicks: z.number().int().positive(),
    }),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
