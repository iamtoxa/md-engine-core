import * as flatbuffers from "flatbuffers";
// Обратите внимание: путь должен совпадать с результатом генерации flatc
import { MDE } from "./generated/messages";

export type EnvelopeDecoded =
  | { bodyType: "Ping"; env: MDE.Envelope; body: MDE.Ping }
  | { bodyType: "Pong"; env: MDE.Envelope; body: MDE.Pong }
  | { bodyType: "ClientHello"; env: MDE.Envelope; body: MDE.ClientHello }
  | { bodyType: "ServerHello"; env: MDE.Envelope; body: MDE.ServerHello }
  | { bodyType: "ClientInput"; env: MDE.Envelope; body: MDE.ClientInput }
  | { bodyType: "Command"; env: MDE.Envelope; body: MDE.Command }
  | { bodyType: "ServerSnapshot"; env: MDE.Envelope; body: MDE.ServerSnapshot }
  | { bodyType: "Error"; env: MDE.Envelope; body: MDE.Error };

export function decodeEnvelope(bytes: Uint8Array): EnvelopeDecoded | null {
  if (!bytes || bytes.byteLength < 8) return null;
  const bb = new flatbuffers.ByteBuffer(bytes);
  const env = MDE.Envelope.getRootAsEnvelope(bb);
  const t = env.bodyType();
  switch (t) {
    case MDE.Body.Ping:
      return {
        bodyType: "Ping",
        env,
        body: env.body(new MDE.Ping()) as MDE.Ping,
      };
    case MDE.Body.Pong:
      return {
        bodyType: "Pong",
        env,
        body: env.body(new MDE.Pong()) as MDE.Pong,
      };
    case MDE.Body.ClientHello:
      return {
        bodyType: "ClientHello",
        env,
        body: env.body(new MDE.ClientHello()) as MDE.ClientHello,
      };
    case MDE.Body.ServerHello:
      return {
        bodyType: "ServerHello",
        env,
        body: env.body(new MDE.ServerHello()) as MDE.ServerHello,
      };
    case MDE.Body.ClientInput:
      return {
        bodyType: "ClientInput",
        env,
        body: env.body(new MDE.ClientInput()) as MDE.ClientInput,
      };
    case MDE.Body.Command:
      return {
        bodyType: "Command",
        env,
        body: env.body(new MDE.Command()) as MDE.Command,
      };
    case MDE.Body.ServerSnapshot:
      return {
        bodyType: "ServerSnapshot",
        env,
        body: env.body(new MDE.ServerSnapshot()) as MDE.ServerSnapshot,
      };
    case MDE.Body.Error:
      return {
        bodyType: "Error",
        env,
        body: env.body(new MDE.Error()) as MDE.Error,
      };
    default:
      return null;
  }
}

export function encodeCommand(
  seq: number,
  type: number,
  payload: Uint8Array
): Uint8Array {
  const b = new flatbuffers.Builder(Math.max(128, 16 + payload.byteLength));
  const pVec = MDE.Command.createPayloadVector(b, payload);
  const cmd = MDE.Command.createCommand(b, type & 0xffff, pVec);
  const env = MDE.Envelope.createEnvelope(
    b,
    seq >>> 0,
    BigInt(Date.now()),
    MDE.Body.Command,
    cmd
  );
  b.finish(env);
  return b.asUint8Array();
}

export function encodePing(seq: number, clientTimeMs: bigint): Uint8Array {
  const b = new flatbuffers.Builder(128);
  const ping = MDE.Ping.createPing(b, clientTimeMs);
  const env = MDE.Envelope.createEnvelope(
    b,
    seq >>> 0,
    clientTimeMs,
    MDE.Body.Ping,
    ping
  );
  b.finish(env);
  return b.asUint8Array();
}

export function encodePong(
  seq: number,
  serverTimeMs: bigint,
  echoClientTimeMs: bigint
): Uint8Array {
  const b = new flatbuffers.Builder(128);
  const pong = MDE.Pong.createPong(b, serverTimeMs, echoClientTimeMs);
  const env = MDE.Envelope.createEnvelope(
    b,
    seq >>> 0,
    serverTimeMs,
    MDE.Body.Pong,
    pong
  );
  b.finish(env);
  return b.asUint8Array();
}

export function encodeServerHello(
  seq: number,
  serverVersion: string,
  protocolMajor: number,
  protocolMinor: number,
  worldId: number,
  tickRate: number,
  timeMs: bigint
): Uint8Array {
  const b = new flatbuffers.Builder(256);
  const verOff = b.createString(serverVersion);
  const helloOff = MDE.ServerHello.createServerHello(
    b,
    verOff,
    protocolMajor & 0xffff,
    protocolMinor & 0xffff,
    worldId >>> 0,
    tickRate & 0xffff,
    timeMs
  );
  const env = MDE.Envelope.createEnvelope(
    b,
    seq >>> 0,
    timeMs,
    MDE.Body.ServerHello,
    helloOff
  );
  b.finish(env);
  return b.asUint8Array();
}

export type EntitySnapInput = {
  id_lo: number;
  gen_hi: number;
  mask: number;
  pos?: [number, number, number];
  rot?: [number, number, number, number];
  vel?: [number, number, number];
  hp?: number;
  owner?: number;
};

export function encodeServerSnapshot(
  full: boolean,
  serverTick: number,
  lastInputSeqAck: number,
  entities: EntitySnapInput[],
  removed: { id_lo: number; gen_hi: number }[]
): Uint8Array {
  const b = new flatbuffers.Builder(Math.max(1024, entities.length * 64));

  // Собираем EntitySnapshot как таблицы через start/add/end
  const entOffsets: number[] = [];
  for (const e of entities) {
    const id = MDE.EntityId.createEntityId(b, e.id_lo >>> 0, e.gen_hi >>> 0);
    const pos = MDE.Vec3f.createVec3f(
      b,
      e.pos?.[0] ?? 0,
      e.pos?.[1] ?? 0,
      e.pos?.[2] ?? 0
    );
    const rot = MDE.Quatf.createQuatf(
      b,
      e.rot?.[0] ?? 0,
      e.rot?.[1] ?? 0,
      e.rot?.[2] ?? 0,
      e.rot?.[3] ?? 1
    );
    const vel = MDE.Vec3f.createVec3f(
      b,
      e.vel?.[0] ?? 0,
      e.vel?.[1] ?? 0,
      e.vel?.[2] ?? 0
    );
    const hp = (e.hp ?? 0) >>> 0;
    const owner = (e.owner ?? 0) >>> 0;
    MDE.EntitySnapshot.startEntitySnapshot(b);
    MDE.EntitySnapshot.addId(b, id);
    MDE.EntitySnapshot.addMask(b, e.mask >>> 0);
    MDE.EntitySnapshot.addPos(b, pos);
    MDE.EntitySnapshot.addRot(b, rot);
    MDE.EntitySnapshot.addVel(b, vel);
    MDE.EntitySnapshot.addHp(b, hp);
    MDE.EntitySnapshot.addOwner(b, owner);
    const ent = MDE.EntitySnapshot.endEntitySnapshot(b);
    entOffsets.push(ent);
  }

  // Вектор entities (вектор таблиц) — можно через startEntitiesVector + addOffset
  MDE.ServerSnapshot.startEntitiesVector(b, entOffsets.length);
  for (let i = entOffsets.length - 1; i >= 0; i--) {
    b.addOffset(entOffsets[i]!);
  }
  const entVec = b.endVector();

  // Вектор removed (вектор структур) — только через startRemovedVector и inline запись структур
  MDE.ServerSnapshot.startRemovedVector(b, removed.length);
  for (let i = removed.length - 1; i >= 0; i--) {
    const r = removed[i];
    MDE.EntityId.createEntityId(b, r!.id_lo >>> 0, r!.gen_hi >>> 0);
  }
  const remVec = b.endVector();

  // Таблица ServerSnapshot через start/add/end
  MDE.ServerSnapshot.startServerSnapshot(b);
  MDE.ServerSnapshot.addFull(b, full);
  MDE.ServerSnapshot.addServerTick(b, serverTick >>> 0);
  MDE.ServerSnapshot.addLastInputSeqAcked(b, lastInputSeqAck >>> 0);
  MDE.ServerSnapshot.addEntities(b, entVec);
  MDE.ServerSnapshot.addRemoved(b, remVec);
  const snap = MDE.ServerSnapshot.endServerSnapshot(b);

  // Оборачиваем в Envelope
  const env = MDE.Envelope.createEnvelope(
    b,
    serverTick >>> 0,
    BigInt(Date.now()),
    MDE.Body.ServerSnapshot,
    snap
  );
  b.finish(env);
  return b.asUint8Array();
}

export function encodeServerInfo(seq: number, worldId: number): Uint8Array {
  const b = new flatbuffers.Builder(128);
  const info = MDE.ServerInfo.createServerInfo(b, worldId >>> 0);
  const env = MDE.Envelope.createEnvelope(
    b,
    seq >>> 0,
    BigInt(Date.now()),
    MDE.Body.ServerInfo,
    info
  );
  b.finish(env);
  return b.asUint8Array();
}
