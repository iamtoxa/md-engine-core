import {
  type FromSupervisor,
  type ToSupervisor,
  type ClientAttachMessage,
  type ClientDetachMessage,
} from "../types/control.js";
import { createLogger } from "../logger.js";
import {
  attachRing,
  readerDequeue,
  writerEnqueue,
  RingFlags,
  decodeEnvelope,
  encodeServerSnapshot,
  type EntitySnapInput,
} from "@iamtoxa/md-engine-net";
import { World as ECSWorld } from "@iamtoxa/md-engine-ecs-core";
import { setupGameKit } from "@iamtoxa/md-engine-game-kit";
import { AOIGrid } from "@iamtoxa/md-engine-game-kit";



interface WorldConfig {
  simulationHz: number;
  networkSnapshotHz: number;
  aoi: { radius: number; cellSize: number };
  snapshot: {
    keyframeIntervalSec: number;
    maxEntitiesPerSnapshot: number;
    maxBytesPerSnapshot: number;
  };
  logs: {
    level: "debug" | "info" | "warn" | "error";
    json: boolean;
    pretty: boolean;
  };
  bounds: {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
  };
}

type ClientCtx = {
  id: string;
  inRing: ReturnType<typeof attachRing>;
  outRing: ReturnType<typeof attachRing>;
  playerEid: number;
  lastInputSeq: number;
  aoiPrev: Set<number>;
  lastKeyTick: number;
};

let startedAt = Date.now();
let tickCount = 0;
let tickInterval: number | null = null;

let worldIndexLocal = 0;

const log = createLogger({
  name: "worker:world",
  level: "debug",
  json: true,
  pretty: false,
});

function memRSS() {
  try {
    // @ts-ignore
    return Number(process.memoryUsage?.().rss ?? 0);
  } catch {
    return 0;
  }
}

function post(msg: ToSupervisor) {
  // @ts-ignore
  postMessage(msg);
}

function startHeartbeat(index: number) {
  const iv = setInterval(() => {
    const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
    post({
      type: "heartbeat",
      workerType: "world",
      index,
      uptimeSec,
      rssBytes: memRSS(),
      world: { tickCount },
    });
  }, 1000) as unknown as number;
  return () => clearInterval(iv);
}

// ECS + AOI
let W: ECSWorld;
let comps: ReturnType<typeof setupGameKit>;
let aoi: AOIGrid;
let snapshotEveryTicks = 1;
let keyframeEveryTicks = 40;

const clients = new Map<string, ClientCtx>();

let worldBounds: WorldConfig["bounds"];

function initECS(cfg: WorldConfig) {
  W = new ECSWorld({ maxEntities: 100_000 });
  comps = setupGameKit(W, { enableDamage: true });
  aoi = new AOIGrid(cfg.aoi.cellSize);
  snapshotEveryTicks = Math.max(
    1,
    Math.round(cfg.simulationHz / cfg.networkSnapshotHz)
  );
  keyframeEveryTicks = Math.max(
    1,
    Math.round(cfg.snapshot.keyframeIntervalSec * cfg.simulationHz)
  );
  worldBounds = cfg.bounds;
}

function applyClientInput(client: ClientCtx, bytes: Uint8Array) {
  const env = decodeEnvelope(bytes);
  if (!env || env.bodyType !== "ClientInput") return;
  const seq = env.body.seq();
  client.lastInputSeq = seq >>> 0;

  const move = [
    env.body.move()!.x(),
    env.body.move()!.y(),
    env.body.move()!.z(),
  ];
  const look = [
    env.body.viewDir()!.x(),
    env.body.viewDir()!.y(),
    env.body.viewDir()!.z(),
  ];
  const buttons = env.body.buttons() >>> 0;
  const analog1 = env.body.analog1();
  const analog2 = env.body.analog2();

  const v = W.componentView(comps.InputState, client.playerEid)!;
  v.write("move", move);
  v.write("look", look);
  v.write("buttons", [buttons]);
  v.write("analog1", [analog1]);
  v.write("analog2", [analog2]);
  v.write("seq", [seq]);
}

function processClientInputs() {
  for (const c of clients.values()) {
    let it = 0;
    while (it++ < 256) {
      const msg = readerDequeue(c.inRing);
      if (!msg) break;
      applyClientInput(c, msg.payload);
    }
  }
}

function updateAOIFromTransforms() {
  const T = comps.Transform3D;
  for (const eid of W.iterComponent(T)) {
    const t = W.componentView(T, eid)!;
    const p = t.read("pos");
    aoi.upsert(eid, p[0]!, p[1]!, p[2]!);
  }
}

function checkBoundsAndMigrate(index: number) {
  // Для всех клиентов (игроков), если вышли за границы — запрос миграции
  for (const c of clients.values()) {
    const t = W.componentView(comps.Transform3D, c.playerEid)!;
    const p = t.read("pos");
    const minX = worldBounds.minX,
      maxX = worldBounds.maxX;
    let targetWorld = -1;
    if (p[0]! < minX) targetWorld = index - 1;
    else if (p[0]! >= maxX) targetWorld = index + 1;
    if (targetWorld >= 0) {
      // Снимем краткое состояние для handoff
      const v = W.componentView(comps.Velocity3D, c.playerEid)!.read("vel");
      const rot = W.componentView(comps.Transform3D, c.playerEid)!.read("rot");
      const hp = W.componentView(comps.Health, c.playerEid)
        ? W.componentView(comps.Health, c.playerEid)!.read("hp")[0]
        : 0;
      const req: import("../types/control.js").RequestMigrateMessage = {
        type: "request_migrate",
        fromWorld: index,
        clientId: c.id,
        targetWorld,
        state: {
          pos: [p[0]!, p[1]!, p[2]!],
          rot: [rot[0]!, rot[1]!, rot[2]!, rot[3]!],
          vel: [v[0]!, v[1]!, v[2]!],
          hp,
        },
      };
      // @ts-ignore
      postMessage(req);
      // После запроса можно пометить сущность на удаление (будет detach)
      // Здесь не удаляем — дождемся client_detach от Supervisor
    }
  }
}

function buildAndSendSnapshot(cfg: WorldConfig, client: ClientCtx) {
  const T = comps.Transform3D;
  const V = comps.Velocity3D;
  const H = comps.Health;

  // позиция игрока
  const tSelf = W.componentView(T, client.playerEid)!;
  const pSelf = tSelf.read("pos");
  const radius = cfg.aoi.radius;

  // кандидаты из соседних клеток
  const cand: number[] = [];
  aoi.queryCells(pSelf[0]!, pSelf[1]!, pSelf[2]!, radius, cand);

  // точная фильтрация по расстоянию
  const r2 = radius * radius;
  const curr = new Set<number>();
  for (const eid of cand) {
    if (eid === client.playerEid) {
      curr.add(eid);
      continue;
    }
    const t = W.componentView(T, eid);
    if (!t) continue;
    const p = t.read("pos");
    const dx = p[0]! - pSelf[0]!,
      dy = p[1]! - pSelf[1]!,
      dz = p[2]! - pSelf[2]!;
    if (dx + dy + dz * dz <= r2) curr.add(eid);
  }
  curr.add(client.playerEid);

  // removed: то, чего больше нет в AOI
  const removed: { id_lo: number; gen_hi: number }[] = [];
  for (const eid of client.aoiPrev) {
    if (!curr.has(eid)) removed.push({ id_lo: eid >>> 0, gen_hi: 0 });
  }

  const full = tickCount - client.lastKeyTick >= keyframeEveryTicks;
  const entities: EntitySnapInput[] = [];
  const maxEnt = cfg.snapshot.maxEntitiesPerSnapshot;
  let count = 0;

  for (const eid of curr) {
    if (count >= maxEnt) break;
    let mask = 0;
    let pos: [number, number, number] | undefined;
    let rot: [number, number, number, number] | undefined;
    let vel: [number, number, number] | undefined;
    let hp: number | undefined;
    let owner: number | undefined;

    const includeT =
      full ||
      W.componentChanged(comps.Transform3D as any, eid) ||
      eid === client.playerEid;
    const includeV =
      full ||
      W.componentChanged(comps.Velocity3D as any, eid) ||
      eid === client.playerEid;
    const includeH = full || W.componentChanged(comps.Health as any, eid);

    if (includeT && W.hasComponentById(comps.Transform3D as any, eid)) {
      const t = W.componentView(T, eid)!;
      pos = t.read("pos") as [number, number, number];
      rot = t.read("rot") as [number, number, number, number];
      mask |= 1 << 0;
    }
    if (includeV && W.hasComponentById(comps.Velocity3D as any, eid)) {
      const v = W.componentView(V, eid)!;
      vel = v.read("vel") as [number, number, number];
      mask |= 1 << 1;
    }
    if (includeH && W.hasComponentById(comps.Health as any, eid)) {
      const hv = W.componentView(H, eid)!;
      hp = hv.read("hp")[0] || 0;
      mask |= 1 << 2;
    }
    // Owner: пока 0 (можно проставить accountId hash позже)
    // mask |= 1 << 3; owner = ...

    if (mask === 0 && !full) continue;

    entities.push({
      id_lo: eid >>> 0,
      gen_hi: 0,
      mask,
      pos,
      rot,
      vel,
      hp,
      owner,
    });
    count++;
  }

  const buf = encodeServerSnapshot(
    full,
    tickCount >>> 0,
    client.lastInputSeq >>> 0,
    entities,
    removed
  );
  const ok = writerEnqueue(client.outRing, 2, RingFlags.Droppable, buf);
  if (!ok) {
    // дроп по backpressure — ничего не делаем
  }

  client.aoiPrev = curr;
  if (full) client.lastKeyTick = tickCount;
}

function tickOnce(cfg: WorldConfig) {
  // обработка входа
  processClientInputs();

  // ECS фазы
  W.tick("input", 0);
  W.tick("simulation", 1.0 / cfg.simulationHz);
  W.tick("post", 0);

  // AOI из трансформов
  updateAOIFromTransforms();

  checkBoundsAndMigrate(worldIndexLocal);

  // снапшоты по частоте
  if (snapshotEveryTicks > 0 && tickCount % snapshotEveryTicks === 0) {
    for (const c of clients.values()) buildAndSendSnapshot(cfg, c);
    W.tick("snapshot", 0);
  }

  tickCount++;
}

function startWorld(cfg: WorldConfig, index: number) {
  initECS(cfg);
  worldIndexLocal = index;
  const dtMs = Math.max(1, Math.floor(1000 / cfg.simulationHz));
  tickInterval = setInterval(() => tickOnce(cfg), dtMs) as unknown as number;
  log.info("world started", {
    hz: cfg.simulationHz,
    snapshotHz: cfg.networkSnapshotHz,
  });
}

function stopWorld() {
  if (tickInterval != null) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  clients.clear();
}

// @ts-ignore
onmessage = (event: MessageEvent<FromSupervisor>) => {
  const data = event.data;
  if (data.type === "init" && data.workerType === "world") {
    const cfg = data.config as WorldConfig;
    startedAt = Date.now();
    startWorld(cfg, data.index);
    post({ type: "ready", workerType: "world", index: data.index });
    (globalThis as any).__stopHB = startHeartbeat(data.index);
  } else if (data.type === "client_attach") {
    const msg = data as ClientAttachMessage;
    const inRing = attachRing(msg.inputSab);
    const outRing = attachRing(msg.outputSab);
    const e = W.createEntity();
    W.addComponent(e as any, comps.Transform3D, {
      pos: [0, 0, 0],
      rot: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });
    W.addComponent(e as any, comps.Velocity3D, { vel: [0, 0, 0] });
    W.addComponent(e as any, comps.InputState, {
      move: [0, 0, 0],
      look: [1, 0, 0],
      buttons: 0,
      analog1: 0,
      analog2: 0,
      seq: 0,
    });
    W.addComponent(e as any, comps.MoveSpeed, { speed: 5 });
    W.addComponent(e as any, comps.PlayerControlled);

    clients.set(msg.clientId, {
      id: msg.clientId,
      inRing,
      outRing,
      playerEid: e.id,
      lastInputSeq: 0,
      aoiPrev: new Set<number>(),
      lastKeyTick: 0,
    });
  } else if (data.type === "client_detach") {
    const msg = data as ClientDetachMessage;
    const c = clients.get(msg.clientId);
    if (c) {
      W.addComponent({ id: c.playerEid, gen: 0 } as any, comps.Destroyed);
      clients.delete(msg.clientId);
    }
  } else if (data.type === "shutdown") {
    (globalThis as any).__stopHB?.();
    stopWorld();
    setTimeout(() => {
      /* @ts-ignore */
      close();
    }, 50);
  } else if ((data as any).type === "client_attach_with_state") {
    const msg =
      data as any as import("../types/control.js").ClientAttachWithStateMessage;
    const inRing = attachRing(msg.inputSab);
    const outRing = attachRing(msg.outputSab);
    // Создаем player entity и применяем состояние
    const e = W.createEntity();
    W.addComponent(e as any, comps.Transform3D, {
      pos: msg.state.pos,
      rot: msg.state.rot,
      scale: [1, 1, 1],
    });
    W.addComponent(e as any, comps.Velocity3D, { vel: msg.state.vel });
    W.addComponent(e as any, comps.InputState, {
      move: [0, 0, 0],
      look: [1, 0, 0],
      buttons: 0,
      analog1: 0,
      analog2: 0,
      seq: 0,
    });
    W.addComponent(e as any, comps.MoveSpeed, { speed: 5 });
    W.addComponent(e as any, comps.PlayerControlled);
    if (msg.state.hp != null) {
      W.addComponent(e as any, comps.Health, {
        hp: msg.state.hp,
        maxHp: msg.state.hp,
      });
    }

    clients.set(msg.clientId, {
      id: msg.clientId,
      inRing,
      outRing,
      playerEid: e.id,
      lastInputSeq: 0,
      aoiPrev: new Set<number>(),
      lastKeyTick: 0,
    });
  }
};


