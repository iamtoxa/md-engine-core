import { createLogger } from "../logger.js";
import { loadConfig, type Config } from "../config/index.js";
import {
  type WorkerType,
  type ToSupervisor,
  type FromSupervisor,
  type ClientAttachMessage,
  type RequestMigrateMessage,
} from "../types/control.js";
import { ZoneManager } from "../zone/zone_manager.js";
import type { ZoneInfo } from "../zone/types.js";
import { PROTOCOL_MAJOR, PROTOCOL_MINOR } from "@iamtoxa/md-engine-net";
import { SERVER_VERSION } from "../version.js";

type WorkerHandle = {
  type: WorkerType;
  index: number;
  worker: Worker;
  startedAt: number;
  lastHeartbeatAt: number;
  restarts: number[];
  backoffStep: number;
  state: "starting" | "ready" | "stopped";
  port?: number; // для gateway
};

const backoffMs = [500, 1000, 2000, 4000, 8000];
const restartWindowMs = 60_000;
const heartbeatTimeoutMs = 5_000;

export class Supervisor {
  private log = createLogger({
    name: "supervisor",
    level: "debug",
    json: true,
    pretty: false,
  });

  private cfg!: Config;
  private handles: WorkerHandle[] = [];
  private hbTimer: number | null = null;
  private stopping = false;

  private zoneMgr!: ZoneManager;
  // Таблица клиента: где привязан (gateway/world) и его SAB'ы
  private clientMap = new Map<
    string,
    {
      gatewayIndex: number;
      worldIndex: number;
      inputSab: SharedArrayBuffer;
      outputSab: SharedArrayBuffer;
    }
  >();

  async start() {
    this.cfg = await loadConfig();
    // Инициализация зон (простая линейная схема по X)
    this.zoneMgr = new ZoneManager(this.nodeId());
    const worldCount = Math.max(1, this.cfg.workers.worldWorkers);
    const zones = this.zoneMgr.initLinearX(worldCount, 512);

    // Gateway'и (порты base+index)
    const gwCount = Math.max(1, this.cfg.workers.gatewayWorkers);
    for (let i = 0; i < gwCount; i++) {
      await this.spawn("gateway", i);
    }
    // Миры (по зонам)
    for (let i = 0; i < zones.length; i++) {
      await this.spawn("world", i);
    }
    // Job-работники (если нужны)
    const jobCount = Math.max(0, this.cfg.workers.jobWorkers);
    for (let i = 0; i < jobCount; i++) {
      await this.spawn("job", i);
    }

    this.hbTimer = setInterval(
      () => this.checkHeartbeats(),
      1000
    ) as unknown as number;

    this.log.info("started", {
      workers: { gateway: gwCount, world: zones.length, job: jobCount },
      zones: zones.map((z) => ({
        id: z.id,
        worldIndex: z.worldIndex,
        bounds: z.bounds,
      })),
    });
  }

  async stop() {
    this.stopping = true;
    this.log.info("stopping");
    if (this.hbTimer != null) clearInterval(this.hbTimer);
    const shutdownMsg: FromSupervisor = { type: "shutdown" };
    for (const h of this.handles) {
      try {
        h.worker.postMessage(shutdownMsg);
      } catch {}
    }
    // небольшая задержка для graceful
    await new Promise((r) => setTimeout(r, 500));
    for (const h of this.handles) {
      try {
        h.worker.terminate();
      } catch {}
    }
    this.handles = [];
    this.log.info("stopped");
  }

  private nodeId() {
    return `${process.pid}@${process.env.HOSTNAME ?? "local"}`;
  }

  private workerUrl(type: WorkerType) {
    if (type === "gateway")
      return new URL("../workers/gateway.js", import.meta.url);
    if (type === "world")
      return new URL("../workers/world.js", import.meta.url);
    return new URL("../workers/job.js", import.meta.url);
  }

  private makeConfigFor(type: WorkerType, index: number) {
    if (type === "gateway") {
      const port = this.cfg.server.port + index;
      const conf = {
        host: this.cfg.server.host,
        port,
        wsPath: this.cfg.server.wsPath,
        restPrefix: this.cfg.server.restPrefix,
        metricsPath: this.cfg.server.metricsPath,
        adminPrefix: this.cfg.server.adminPrefix,
        logs: this.cfg.logs,
        serverVersion: SERVER_VERSION,
        protocolMajor: PROTOCOL_MAJOR,
        protocolMinor: PROTOCOL_MINOR,
        tickRate: this.cfg.simulation.simulationHz,

        env: this.cfg.env,
        corsOrigins: this.cfg.server.corsOrigins,
        trustProxy: this.cfg.server.trustProxy,
        worldCount: Math.max(1, this.cfg.workers.worldWorkers),

        ipc: {
          inputBytes: this.cfg.ipc.clientInputSabBytes,
          outputBytes: this.cfg.ipc.clientOutputSabBytes,
        },
        limits: {
          maxWsFrameBytes: this.cfg.protocolLimits.maxWsFrameBytes,
          maxMessageBytes: this.cfg.protocolLimits.maxMessageBytes,
          inputRate: {
            ratePerSec: this.cfg.protocolLimits.inputRate.ratePerSec,
            burst: this.cfg.protocolLimits.inputRate.burst,
          },
          ipConnections: 64,
        },
        auth: {
          alg: this.cfg.auth.jwt.algorithm,
          secret: this.cfg.auth.jwt.secret,
        },
        flagsPath: this.cfg.flags.path,
      };
      return { conf, port };
    }
    if (type === "world") {
      const z = this.zoneMgr.getByWorldIndex(index)!;
      const conf = {
        simulationHz: this.cfg.simulation.simulationHz,
        networkSnapshotHz: this.cfg.simulation.networkSnapshotHz,
        aoi: this.cfg.aoi,
        snapshot: this.cfg.snapshot,
        bounds: z.bounds,
        logs: this.cfg.logs,
      };
      return { conf };
    }
    const conf = { logs: this.cfg.logs };
    return { conf };
  }

  private async spawn(type: WorkerType, index: number) {
    const url = this.workerUrl(type);
    const w = new Worker(url, { type: "module", name: `${type}-${index}` });
    const handle: WorkerHandle = {
      type,
      index,
      worker: w,
      startedAt: Date.now(),
      lastHeartbeatAt: Date.now(),
      restarts: [],
      backoffStep: 0,
      state: "starting",
    };
    const { conf, port } = this.makeConfigFor(type, index);
    if (port) handle.port = port;

    const onMessage = (ev: MessageEvent<ToSupervisor>) => {
      const msg = ev.data;
      // ready
      if (
        msg.type === "ready" &&
        msg.workerType === type &&
        msg.index === index
      ) {
        handle.state = "ready";
        this.log.info("worker ready", { type, index, port: handle.port });
        return;
      }
      // heartbeat
      if (
        msg.type === "heartbeat" &&
        msg.workerType === type &&
        msg.index === index
      ) {
        handle.lastHeartbeatAt = Date.now();
        return;
      }
      // gateway -> client_open
      if (
        (msg as any).type === "client_open" &&
        (msg as any).workerType === "gateway"
      ) {
        const m = msg as any as import("../types/control.js").ClientOpenMessage;
        // сохранить маршрут клиента
        this.clientMap.set(m.clientId, {
          gatewayIndex: m.index,
          worldIndex: m.worldIndex,
          inputSab: m.inputSab,
          outputSab: m.outputSab,
        });
        // форвард attach в соответствующий мир
        const worldHandle = this.handles.find(
          (h) => h.type === "world" && h.index === m.worldIndex
        );
        if (!worldHandle) {
          this.log.warn("no world for client", {
            clientId: m.clientId,
            worldIndex: m.worldIndex,
          });
          return;
        }
        const attach: ClientAttachMessage = {
          type: "client_attach",
          clientId: m.clientId,
          fromGateway: { index: m.index },
          inputSab: m.inputSab,
          outputSab: m.outputSab,
        };
        worldHandle.worker.postMessage(attach);
        return;
      }
      // gateway -> client_close
      if (
        (msg as any).type === "client_close" &&
        (msg as any).workerType === "gateway"
      ) {
        const m =
          msg as any as import("../types/control.js").ClientCloseMessage;
        const entry = this.clientMap.get(m.clientId);
        if (entry) this.clientMap.delete(m.clientId);
        const worldHandle = this.handles.find(
          (h) => h.type === "world" && h.index === m.worldIndex
        );
        if (worldHandle) {
          const detach = {
            type: "client_detach",
            clientId: m.clientId,
          } as FromSupervisor;
          worldHandle.worker.postMessage(detach);
        }
        return;
      }
      // world -> request_migrate
      if ((msg as any).type === "request_migrate") {
        const rm = msg as any as RequestMigrateMessage;
        this.handleLocalMigration(rm).catch((err) => {
          this.log.error("migration failed", {
            clientId: rm.clientId,
            error: String(err),
          });
        });
        return;
      }
    };
    // @ts-ignore
    w.onmessage = onMessage;
    // @ts-ignore
    w.onerror = (err: any) => {
      this.log.error("worker error", {
        type,
        index,
        error: String(err?.message ?? err),
      });
      this.scheduleRestart(handle);
    };

    const initMsg: FromSupervisor = {
      type: "init",
      workerType: type,
      index,
      config: conf,
    };
    w.postMessage(initMsg);

    this.handles.push(handle);
  }

  private scheduleRestart(h: WorkerHandle) {
    if (this.stopping) return;
    const now = Date.now();
    h.restarts = h.restarts.filter((t) => now - t < restartWindowMs);
    h.restarts.push(now);
    const backoff = backoffMs[Math.min(backoffMs.length - 1, h.backoffStep)];
    h.backoffStep = Math.min(h.backoffStep + 1, backoffMs.length - 1);
    this.log.warn("schedule restart", {
      type: h.type,
      index: h.index,
      backoff,
    });
    setTimeout(async () => {
      try {
        h.worker.terminate();
      } catch {}
      // убрать старый handle
      this.handles = this.handles.filter(
        (x) => !(x.type === h.type && x.index === h.index)
      );
      await this.spawn(h.type, h.index);
    }, backoff);
  }

  private checkHeartbeats() {
    const now = Date.now();
    for (const h of this.handles) {
      if (now - h.lastHeartbeatAt > heartbeatTimeoutMs) {
        this.log.warn("heartbeat missed -> restart", {
          type: h.type,
          index: h.index,
          lastMsAgo: now - h.lastHeartbeatAt,
        });
        this.scheduleRestart(h);
      }
    }
  }

  // Локальная миграция между мирами (в пределах одного узла/процесса)
  private async handleLocalMigration(rm: RequestMigrateMessage) {
    const fromWorld = this.handles.find(
      (h) => h.type === "world" && h.index === rm.fromWorld
    );
    const toWorld = this.handles.find(
      (h) => h.type === "world" && h.index === rm.targetWorld
    );
    const entry = this.clientMap.get(rm.clientId);
    if (!fromWorld || !toWorld || !entry) {
      this.log.warn("migration invalid", {
        clientId: rm.clientId,
        fromWorld: rm.fromWorld,
        targetWorld: rm.targetWorld,
      });
      return;
    }
    // 1) Отвязать от старого мира
    fromWorld.worker.postMessage({
      type: "client_detach",
      clientId: rm.clientId,
    } as FromSupervisor);
    // 2) Привязать к новому миру с начальными данными
    const attach: import("../types/control.js").ClientAttachWithStateMessage = {
      type: "client_attach_with_state",
      clientId: rm.clientId,
      fromWorld: rm.fromWorld,
      toWorld: rm.targetWorld,
      inputSab: entry.inputSab,
      outputSab: entry.outputSab,
      state: rm.state,
    };
    toWorld.worker.postMessage(attach);
    // 3) Обновить маршрут
    entry.worldIndex = rm.targetWorld;
    this.clientMap.set(rm.clientId, entry);
    // 4) Уведомить gateway → отправить ServerInfo(world_id)
    const gw = this.handles.find(
      (h) => h.type === "gateway" && h.index === entry.gatewayIndex
    );
    if (gw) {
      const notify: import("../types/control.js").ClientZoneChangeNotify = {
        type: "client_zone_change",
        clientId: rm.clientId,
        gatewayIndex: entry.gatewayIndex,
        worldId: rm.targetWorld >>> 0,
      };
      gw.worker.postMessage(notify as any);
    }
  }
}

export async function startSupervisor() {
  const sup = new Supervisor();
  await sup.start();
  return sup;
}
