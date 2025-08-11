import os from "os";
import { type Config } from "./schema.js";

export function cpuCount(): number {
  try {
    return Math.max(1, os.cpus()?.length ?? 1);
  } catch {
    return 1;
  }
}

export function makeDefaults(env: Config["env"]): Config {
  const cpus = cpuCount();
  const isDev = env === "dev";

  return {
    env,
    server: {
      host: "0.0.0.0",
      port: 8080,
      wsPath: "/ws",
      restPrefix: "/api",
      metricsPath: "/metrics",
      adminPrefix: "/admin",
      corsOrigins: ["*"],
      trustProxy: env === "prod",
    },
    simulation: { simulationHz: 30, networkSnapshotHz: 20 },
    aoi: { radius: 50, cellSize: 16 },
    snapshot: {
      keyframeIntervalSec: 2,
      maxEntitiesPerSnapshot: 400,
      maxBytesPerSnapshot: 48 * 1024,
    },
    workers: {
      gatewayWorkers: 1,
      worldWorkers: Math.max(1, cpus - 1),
      jobWorkers: 0,
    },
    ipc: {
      clientInputSabBytes: 1 << 20,
      clientOutputSabBytes: 1 << 20,
      controlSabBytes: 256 * 1024,
    },
    protocolLimits: {
      maxWsFrameBytes: 256 * 1024,
      maxMessageBytes: 64 * 1024,
      inputRate: { ratePerSec: 60, burst: 30 },
      maxConnections: 10_000,
    },
    logs: { json: true, pretty: isDev, level: isDev ? "debug" : "info" },
    metrics: { enabled: true },
    tracing: { enabled: false },
    flags: { path: "config/flags.json", hotReload: isDev },
    auth: {
      jwt: {
        algorithm: "HS256",
        secret: "dev-secret",
        accessTtl: "15m",
        refreshTtl: "7d",
      },
    },
    worldLimits: {
      softMaxEntitiesPerWorld: 10_000,
      softMaxPlayersPerWorld: 500,
      splitTrigger: { p99TickMs: 28, consecutiveTicks: 30 },
    },
    modules: [], // по умолчанию нет модулей
  };
}
