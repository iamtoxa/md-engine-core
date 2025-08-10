export type WorkerType = "gateway" | "world" | "job";

export interface InitMessage {
  type: "init";
  workerType: WorkerType;
  index: number;
  config: unknown;
}
export interface ReadyMessage {
  type: "ready";
  workerType: WorkerType;
  index: number;
}
export interface HeartbeatMessage {
  type: "heartbeat";
  workerType: WorkerType;
  index: number;
  uptimeSec: number;
  rssBytes: number;
  world?: { tickCount: number };
}
export interface ShutdownMessage {
  type: "shutdown";
}

// Новый: события клиентов
export interface ClientOpenMessage {
  type: "client_open";
  workerType: "gateway";
  index: number;
  clientId: string;
  worldIndex: number;
  inputSab: SharedArrayBuffer; // gateway->world
  outputSab: SharedArrayBuffer; // world->gateway
}
export interface ClientCloseMessage {
  type: "client_close";
  workerType: "gateway";
  index: number;
  clientId: string;
  worldIndex: number;
}
export interface ClientAttachMessage {
  type: "client_attach";
  clientId: string;
  fromGateway: { index: number };
  inputSab: SharedArrayBuffer;
  outputSab: SharedArrayBuffer;
}
export interface ClientDetachMessage {
  type: "client_detach";
  clientId: string;
}

// Новое: запрос миграции из мира (с кратким состоянием)
export interface RequestMigrateMessage {
  type: "request_migrate";
  fromWorld: number;
  clientId: string;
  targetWorld: number;
  state: {
    pos: [number, number, number];
    rot: [number, number, number, number];
    vel: [number, number, number];
    hp?: number;
  };
}

// Новое: attach в целевой мир с начальными данными
export interface ClientAttachWithStateMessage {
  type: "client_attach_with_state";
  clientId: string;
  fromWorld: number;
  toWorld: number;
  inputSab: SharedArrayBuffer;
  outputSab: SharedArrayBuffer;
  state: {
    pos: [number, number, number];
    rot: [number, number, number, number];
    vel: [number, number, number];
    hp?: number;
  };
}

// Новое: уведомление Gateway — отправить ServerInfo(world_id)
export interface ClientZoneChangeNotify {
  type: "client_zone_change";
  clientId: string;
  gatewayIndex: number;
  worldId: number;
}

export type FromSupervisor =
  | InitMessage
  | ShutdownMessage
  | ClientAttachMessage
  | ClientDetachMessage
  | ClientAttachWithStateMessage;

export type ToSupervisor =
  | ReadyMessage
  | HeartbeatMessage
  | ClientOpenMessage
  | ClientCloseMessage
  | RequestMigrateMessage;
