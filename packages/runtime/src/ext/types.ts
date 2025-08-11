type PluginTarget = "gateway" | "world" | "job" | "all";

export interface PluginMeta {
  name: string;
  version?: string;
  target?: PluginTarget;
}

export interface GatewayContext {
  addRestRoute(
    path: string,
    handler: (c: any) => Promise<Response> | Response
  ): void;
  addAdminRoute(
    path: string,
    handler: (c: any) => Promise<Response> | Response
  ): void;
  registerWsHandler(
    handler: (
      clientId: string,
      data: Uint8Array,
      send: (bytes: Uint8Array) => void
    ) => boolean | void
  ): void;
  metrics: { counter(name: string): { inc(v?: number): void } };
  log: {
    info(msg: string, extra?: any): void;
    warn(msg: string, extra?: any): void;
    error(msg: string, extra?: any): void;
  };
  options: Record<string, unknown>;
}

export interface WorldContext {
  world: import("@iamtoxa/md-engine-ecs-core").World;
  addSystem(sys: import("@iamtoxa/md-engine-ecs-core").System): void;
  timing: { hz: number; snapshotHz: number };
  log: {
    info(msg: string, extra?: any): void;
    warn(msg: string, extra?: any): void;
    error(msg: string, extra?: any): void;
  };
  metrics: { counter(name: string): { inc(v?: number): void } };
  options: Record<string, unknown>;
  registerMessage(
    type: number,
    handler: (clientId: string, payload: Uint8Array) => void
  ): void;
  sendToClient(clientId: string, bytes: Uint8Array): boolean;
}

export interface JobContext {
  registerJob(
    name: string,
    handler: (payload: unknown) => Promise<unknown> | unknown
  ): void;
  log: {
    info(msg: string, extra?: any): void;
    warn(msg: string, extra?: any): void;
    error(msg: string, extra?: any): void;
  };
  metrics: { counter(name: string): { inc(v?: number): void } };
  options: Record<string, unknown>;
}

export interface Plugin {
  meta: PluginMeta;
  init?(ctx: {
    gateway?: GatewayContext;
    world?: WorldContext;
    job?: JobContext;
  }): Promise<void> | void;
}
