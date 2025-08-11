import { Hono } from "hono";
import { jwtVerify, SignJWT } from "jose";
import {
  type FromSupervisor,
  type ToSupervisor,
  type ClientOpenMessage,
  type ClientCloseMessage,
} from "../types/control.js";
import { createLogger } from "../logger.js";
import {
  createRing,
  attachRing,
  writerEnqueue,
  readerDequeue,
  decodeEnvelope,
  encodePing,
  encodePong,
  encodeServerHello,
  encodeServerInfo,
} from "@iamtoxa/md-engine-net";
import type { ModuleConfig } from "../config/schema.js";
import type { ServerWebSocket } from "bun";

interface GatewayConfig {
  host: string;
  port: number;
  wsPath: string;
  restPrefix: string;
  metricsPath: string;
  adminPrefix: string;
  logs: {
    level: "debug" | "info" | "warn" | "error";
    json: boolean;
    pretty: boolean;
  };

  serverVersion: string;
  protocolMajor: number;
  protocolMinor: number;
  tickRate: number;

  env: "dev" | "prod" | "test";
  corsOrigins: string[];
  trustProxy: boolean;
  worldCount: number;
  ipc: { inputBytes: number; outputBytes: number };
  limits: {
    maxWsFrameBytes: number;
    maxMessageBytes: number;
    inputRate: { ratePerSec: number; burst: number };
    ipConnections: number;
  };
  auth: { alg: "HS256"; secret: string };
  flagsPath: string;

  // новое: модули
  modules: ModuleConfig[];
}

type ClientState = {
  id: string;
  ws: ServerWebSocket<unknown>;
  worldIndex: number;
  toWorld: ReturnType<typeof attachRing>;
  fromWorld: ReturnType<typeof attachRing>;
  pump: number | null;
  drops: number;
  tokens: number;
  lastRefillMs: number;
  violations: number;
  lastActivity: number;
  pingTimer: number | null;
  accountId: string;
  ip: string;
};

let server: ReturnType<typeof Bun.serve> | null = null;
let startedAt = Date.now();

let wsConnTotal = 0;
let wsMsgIn = 0;
let wsMsgOut = 0;
let wsDroppedIn = 0;
let wsDroppedOut = 0;
let wsRateLimited = 0;
let wsAuthFail = 0;
let wsOriginBlocked = 0;

let restReqTotal = 0;
let restRateLimited = 0;
let restAuthFail = 0;

const ipConn = new Map<string, number>();
const clients = new Map<string, ClientState>();
let clientSeq = 0;
let rrWorld = 0;

const log = createLogger({
  name: "worker:gateway",
  level: "debug",
  json: true,
  pretty: false,
});

function memRSS() {
  try {
    return Number(process.memoryUsage?.().rss ?? 0);
  } catch {
    return 0;
  }
}
function post(msg: ToSupervisor) {
  // @ts-ignore
  postMessage(msg);
}
function nowMs() {
  return Date.now();
}
function corsAllowed(origins: string[], origin: string | null) {
  if (!origin) return true;
  if (origins.includes("")) return true;
  return origins.includes(origin);
}
function clientIP(req: Request, trustProxy: boolean): string {
  const h = req.headers;
  if (trustProxy) {
    const xff = h.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
    const xr = h.get("x-real-ip");
    if (xr) return xr;
  }
  return "unknown";
}
function setCorsHeaders(
  resp: Response,
  origin: string | null,
  allowed: string[] | string
) {
  const headers = new Headers(resp.headers);
  if (allowed === "") headers.set("access-control-allow-origin", "*");
  else if (origin && allowed.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }
  headers.set("access-control-allow-headers", "Content-Type, Authorization");
  headers.set(
    "access-control-allow-methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  headers.set("access-control-max-age", "600");
  return new Response(resp.body, { status: resp.status, headers });
}
function refillTokens(c: ClientState, ratePerSec: number, burst: number) {
  const now = nowMs();
  const elapsed = Math.max(0, now - c.lastRefillMs);
  if (elapsed > 0) {
    c.tokens = Math.min(burst, c.tokens + (elapsed / 1000) * ratePerSec);
    c.lastRefillMs = now;
  }
}
function startPump(c: ClientState) {
  c.pump = setInterval(() => {
    let iter = 0;
    while (iter++ < 64) {
      const msg = readerDequeue(c.fromWorld);
      if (!msg) break;
      try {
        c.ws.send(msg.payload);
        wsMsgOut++;
      } catch {
        break;
      }
    }
  }, 5) as unknown as number;
}
function stopPump(c: ClientState) {
  if (c.pump != null) {
    clearInterval(c.pump);
    c.pump = null;
  }
  if (c.pingTimer != null) {
    clearInterval(c.pingTimer);
    c.pingTimer = null;
  }
}

function startKeepAlive(c: ClientState) {
  c.pingTimer = setInterval(() => {
    const idleMs = nowMs() - c.lastActivity;
    if (idleMs > 60_000) {
      try {
        c.ws.close(1008, "idle_timeout");
      } catch {}
      return;
    }
    const ping = encodePing(0, BigInt(nowMs()));
    try {
      c.ws.send(ping);
      wsMsgOut++;
    } catch {}
  }, 25_000) as unknown as number;
}
function fnv1a32(input: string): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return "u-" + h.toString(16).padStart(8, "0");
}
async function verifyJWT(token: string | null, secret: string) {
  if (!token) return null;
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: "md-engine",
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
function bearerToken(req: Request): string | null {
  const a = req.headers.get("authorization");
  if (a && a.toLowerCase().startsWith("bearer ")) return a.slice(7).trim();
  return null;
}
function parseTTL(ttl: string): number {
  const m = ttl.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!m) return 0;
  const val = Number(m[1]);
  switch (m[2]) {
    case "ms":
      return Math.floor(val / 1000);
    case "s":
      return val;
    case "m":
      return val * 60;
    case "h":
      return val * 3600;
    case "d":
      return val * 86400;
    default:
      return 0;
  }
}
function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function jsonErr(code: string, message: string, http = 400) {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status: http,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Плагины: маршруты и WS-хендлеры
type Route = {
  path: string;
  handler: (c: any) => Promise<Response> | Response;
};
const pluginRestRoutes: Route[] = [];
const pluginAdminRoutes: Route[] = [];
const pluginWsHandlers: Array<
  (
    clientId: string,
    data: Uint8Array,
    send: (bytes: Uint8Array) => void
  ) => boolean | void
> = [];
const pluginMetrics = new Map<string, number>();
function metricsCounter(name: string) {
  return {
    inc: (v = 1) => pluginMetrics.set(name, (pluginMetrics.get(name) ?? 0) + v),
  };
}

async function loadGatewayPlugins(cfg: GatewayConfig, app: Hono) {
  for (const m of cfg.modules) {
    if (m.target !== "gateway" && m.target !== "all") continue;
    try {
      const mod = await import(/* @vite-ignore */ m.entry);
      const plugin: import("../ext/types.js").Plugin =
        mod.default ?? mod.plugin ?? mod;
      if (plugin?.init) {
        const ctx: import("../ext/types.js").GatewayContext = {
          addRestRoute: (path, handler) =>
            pluginRestRoutes.push({ path, handler }),
          addAdminRoute: (path, handler) =>
            pluginAdminRoutes.push({ path, handler }),
          registerWsHandler: (handler) => pluginWsHandlers.push(handler),
          metrics: { counter: metricsCounter },
          log: {
            info: (msg, extra) => log.info(msg, extra),
            warn: (msg, extra) => log.warn(msg, extra),
            error: (msg, extra) => log.error(msg, extra),
          },
          options: m.options ?? {},
        };
        await plugin.init({ gateway: ctx });
        log.info("plugin loaded (gateway)", { name: m.name });
      }
    } catch (e) {
      log.error("plugin load failed (gateway)", {
        name: m.name,
        error: String(e),
      });
    }
  }
  // Зарегистрируем маршруты
  for (const r of pluginRestRoutes) app.get(r.path, (c) => r.handler(c));
  for (const r of pluginAdminRoutes) app.get(r.path, (c) => r.handler(c));
}

function startGateway(cfg: GatewayConfig, index: number) {
  const app = new Hono();

  // CORS + preflight
  app.use("", async (c, next) => {
    const origin = c.req.header("origin") ?? null;
    if (c.req.method === "OPTIONS") {
      const allowed = cfg.corsOrigins.includes("") ? "" : cfg.corsOrigins;
      return setCorsHeaders(
        new Response(null, { status: 204 }),
        origin,
        allowed
      );
    }
    await next();
    const allowed = cfg.corsOrigins.includes("") ? "*" : cfg.corsOrigins;
    c.res = setCorsHeaders(c.res, origin, allowed);
  });

  // Rate-limit REST минимально
  const REST_BODY_LIMIT = 64 * 1024;
  app.use("*", async (c, next) => {
    const cl = c.req.header("content-length");
    if (cl) {
      const n = Number(cl);
      if (Number.isFinite(n) && n > REST_BODY_LIMIT) {
        restReqTotal++;
        return c.body(
          JSON.stringify({
            ok: false,
            error: { code: "body_too_large", message: "Body exceeds 64KiB" },
          }),
          413
        );
      }
    }
    await next();
  });

  async function signJwt(payload: Record<string, unknown>, ttlSec: number) {
    const key = new TextEncoder().encode(cfg.auth.secret);
    const now = Math.floor(nowMs() / 1000);
    const jwt = await new SignJWT({ ...payload })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(now)
      .setExpirationTime(now + ttlSec)
      .setIssuer("md-engine")
      .sign(key);
    return jwt;
  }
  async function verifyAccess(c: any) {
    const t = bearerToken(c.req.raw);
    if (!t) {
      restAuthFail++;
      restReqTotal++;
      return c.body(
        JSON.stringify({
          ok: false,
          error: { code: "unauthorized", message: "Missing token" },
        }),
        401
      );
    }
    try {
      const key = new TextEncoder().encode(cfg.auth.secret);
      const { payload } = await jwtVerify(t, key, {
        algorithms: ["HS256"],
        issuer: "md-engine",
      });
      if (payload.typ !== "access" || typeof payload.sub !== "string")
        throw new Error("bad typ/sub");
      c.set("user", {
        sub: payload.sub as string,
        role: (payload as any).role ?? "user",
      });
      return null;
    } catch {
      restAuthFail++;
      restReqTotal++;
      return c.body(
        JSON.stringify({
          ok: false,
          error: { code: "unauthorized", message: "Invalid token" },
        }),
        401
      );
    }
  }
  async function verifyAdmin(c: any) {
    const t = bearerToken(c.req.raw);
    if (!t) {
      restAuthFail++;
      restReqTotal++;
      return c.body(
        JSON.stringify({
          ok: false,
          error: { code: "unauthorized", message: "Missing token" },
        }),
        401
      );
    }
    try {
      const key = new TextEncoder().encode(cfg.auth.secret);
      const { payload } = await jwtVerify(t, key, {
        algorithms: ["HS256"],
        issuer: "md-engine",
      });
      if (payload.typ !== "access" || (payload as any).role !== "admin")
        throw new Error("not admin");
      c.set("user", { sub: payload.sub as string, role: "admin" });
      return null;
    } catch {
      restAuthFail++;
      restReqTotal++;
      return c.body(
        JSON.stringify({
          ok: false,
          error: { code: "forbidden", message: "Admin required" },
        }),
        403
      );
    }
  }

  // REST базовые маршруты (короткая версия)
  const v1 = `${cfg.restPrefix}/v1`;
  console.log(`${v1}/server/info`);
  app.get(`${v1}/server/info`, (c) => {
    restReqTotal++;
    return jsonOk({
      version: cfg.serverVersion,
      protocol: { major: cfg.protocolMajor, minor: cfg.protocolMinor },
      tickRate: cfg.tickRate,
      worldCount: cfg.worldCount,
      env: cfg.env,
    });
  });
  app.post(`${v1}/auth/login`, async (c) => {
    restReqTotal++;
    const body = (await c.req.json().catch(() => null)) as {
      login?: string;
      password?: string;
      role?: string;
    } | null;
    if (!body?.login) return jsonErr("bad_request", "login is required", 400);
    const sub = fnv1a32(body.login);
    const role = body.role === "admin" ? "admin" : "user";
    const accessTtl = parseTTL("15m") || 15 * 60;
    const refreshTtl = parseTTL("7d") || 7 * 24 * 3600;
    const accessToken = await signJwt({ sub, role, typ: "access" }, accessTtl);
    const refreshToken = await signJwt(
      { sub, role, typ: "refresh" },
      refreshTtl
    );
    return jsonOk({
      sub,
      role,
      accessToken,
      refreshToken,
      accessExpiresIn: accessTtl,
      refreshExpiresIn: refreshTtl,
    });
  });

  app.post(`${v1}/auth/refresh`, async (c) => {
    restReqTotal++;
    const token =
      bearerToken(c.req.raw) ??
      (await c.req.json().catch(() => null))?.refreshToken;
    if (!token) return jsonErr("unauthorized", "Missing token", 401);
    try {
      const key = new TextEncoder().encode(cfg.auth.secret);
      const { payload } = await jwtVerify(token, key, {
        algorithms: ["HS256"],
        issuer: "md-engine",
      });
      if (payload.typ !== "refresh" || typeof payload.sub !== "string")
        throw new Error("bad refresh");
      const role = (payload as any).role === "admin" ? "admin" : "user";
      const accessTtl = parseTTL("15m") || 15 * 60;
      const refreshTtl = parseTTL("7d") || 7 * 24 * 3600;
      const accessToken = await signJwt(
        { sub: payload.sub, role, typ: "access" },
        accessTtl
      );
      const refreshToken = await signJwt(
        { sub: payload.sub, role, typ: "refresh" },
        refreshTtl
      );
      return jsonOk({
        sub: payload.sub,
        role,
        accessToken,
        refreshToken,
        accessExpiresIn: accessTtl,
        refreshExpiresIn: refreshTtl,
      });
    } catch {
      return jsonErr("unauthorized", "Invalid refresh", 401);
    }
  });

  app.get(`${v1}/me`, async (c) => {
    restReqTotal++;
    const err = await verifyAccess(c);
    if (err) return err;
    const user = (c as any).get("user") as { sub: string; role: string };
    return jsonOk({ sub: user.sub, role: user.role });
  });

  app.get(`${cfg.adminPrefix}/flags`, async (c) => {
    restReqTotal++;
    const err = await verifyAdmin(c);
    if (err) return err;
    try {
      const file = Bun.file(cfg.flagsPath);
      const exists = await file.exists();
      if (!exists) return jsonOk({});
      const text = await file.text();
      return jsonOk(JSON.parse(text));
    } catch {
      return jsonErr("flags_read_error", "Cannot read flags", 500);
    }
  });

  app.post(`${cfg.adminPrefix}/scale`, async (c) => {
    restReqTotal++;
    const err = await verifyAdmin(c);
    if (err) return err;
    return jsonErr(
      "not_implemented",
      "Scaling API is not implemented yet",
      501
    );
  });

  app.get(`${v1}/worlds`, (c) => {
    restReqTotal++;
    const worlds = Array.from(
      { length: Math.max(1, cfg.worldCount) },
      (_, i) => ({ id: i })
    );
    return jsonOk({ worlds });
  });
  app.get(cfg.metricsPath, (c) => {
    c.header("content-type", "text/plain; charset=utf-8");
    const lines = [
      `ws_connections_total ${wsConnTotal}`,
      `ws_messages_in_total ${wsMsgIn}`,
      `ws_messages_out_total ${wsMsgOut}`,
      `ws_dropped_in_total ${wsDroppedIn}`,
      `ws_dropped_out_total ${wsDroppedOut}`,
      `ws_rate_limited_total ${wsRateLimited}`,
      `ws_auth_fail_total ${wsAuthFail}`,
      `ws_origin_blocked_total ${wsOriginBlocked}`,
      `rest_requests_total ${restReqTotal}`,
      `rest_rate_limited_total ${restRateLimited}`,
      `rest_auth_fail_total ${restAuthFail}`,
    ];
    // Плагины метрики
    for (const [k, v] of pluginMetrics) lines.push(`plugin_${k} ${v}`);
    return c.body(lines.join("\n") + "\n");
  });

  // Загрузка плагинов ДО старта сервера
  loadGatewayPlugins(cfg, app).then(() => {
    server = Bun.serve({
      hostname: cfg.host,
      port: cfg.port,
      fetch: async (req, srv) => {
        const url = new URL(req.url);
        if (url.pathname === cfg.wsPath) {
          const origin = req.headers.get("origin");
          if (!corsAllowed(cfg.corsOrigins, origin)) {
            wsOriginBlocked++;
            return new Response("Forbidden origin", { status: 403 });
          }
          let token: string | null = null;
          const auth = req.headers.get("authorization");
          if (auth && auth.toLowerCase().startsWith("bearer "))
            token = auth.slice(7).trim();
          if (!token) token = url.searchParams.get("token");
          const sub = await verifyJWT(token, cfg.auth.secret);
          if (!sub) {
            wsAuthFail++;
            return new Response("Unauthorized", { status: 401 });
          }
          const ip = clientIP(req, cfg.trustProxy);
          const cur = ipConn.get(ip) ?? 0;
          if (cur >= cfg.limits.ipConnections)
            return new Response("Too many connections from IP", {
              status: 429,
            });
          const ok = srv.upgrade(req, { data: { accountId: sub, ip } });
          if (ok) return;
          return new Response("Upgrade failed", { status: 400 });
        }
        return app.fetch(req);
      },
      websocket: {
        perMessageDeflate: false,
        open(ws) {
          wsConnTotal++;
          const id = `c-${index}-${++clientSeq}`;
          const accountId = (ws.data as any)?.accountId ?? "anon";
          const ip = (ws.data as any)?.ip ?? "unknown";
          ipConn.set(ip, (ipConn.get(ip) ?? 0) + 1);
          const worldIndex = rrWorld++ % Math.max(1, cfg.worldCount);
          const inRing = createRing(cfg.ipc.inputBytes);
          const outRing = createRing(cfg.ipc.outputBytes);

          const state: ClientState = {
            id,
            ws,
            worldIndex,
            toWorld: attachRing(inRing.sab),
            fromWorld: attachRing(outRing.sab),
            pump: null,
            drops: 0,
            tokens: cfg.limits.inputRate.burst,
            lastRefillMs: nowMs(),
            violations: 0,
            lastActivity: nowMs(),
            pingTimer: null,
            accountId,
            ip,
          };
          (ws as any).__state = state;
          clients.set(id, state);

          const hello = encodeServerHello(
            1,
            cfg.serverVersion,
            cfg.protocolMajor,
            cfg.protocolMinor,
            worldIndex >>> 0,
            cfg.tickRate & 0xffff,
            BigInt(nowMs())
          );
          try {
            ws.send(hello);
            wsMsgOut++;
          } catch {}

          const msg: ClientOpenMessage = {
            type: "client_open",
            workerType: "gateway",
            index,
            clientId: id,
            worldIndex,
            inputSab: inRing.sab,
            outputSab: outRing.sab,
          };
          post(msg);

          startPump(state);
          // Пинг/idle
          state.pingTimer = setInterval(() => {
            const idleMs = nowMs() - state.lastActivity;
            if (idleMs > 60_000) {
              try {
                ws.close(1008, "idle_timeout");
              } catch {}
              return;
            }
            const ping = encodePing(0, BigInt(nowMs()));
            try {
              ws.send(ping);
              wsMsgOut++;
            } catch {}
          }, 25_000) as unknown as number;
        },
        message(ws, message) {
          const c: ClientState | undefined = (ws as any).__state;
          if (!c) return;
          c.lastActivity = nowMs();
          wsMsgIn++;

          if (typeof message === "string") return;
          if (!(message instanceof Uint8Array)) return;
          if (
            message.byteLength > cfg.limits.maxWsFrameBytes ||
            message.byteLength > cfg.limits.maxMessageBytes
          ) {
            try {
              ws.close(1008, "frame_too_large");
            } catch {}
            return;
          }

          refillTokens(
            c,
            cfg.limits.inputRate.ratePerSec,
            cfg.limits.inputRate.burst
          );
          if (c.tokens < 1) {
            c.violations++;
            wsRateLimited++;
            if (c.violations >= 3) {
              try {
                ws.close(1008, "rate_limit");
              } catch {}
            }
            return;
          }
          c.tokens -= 1;
          c.violations = 0;

          // Протокол Ping → Pong
          const env = decodeEnvelope(message);
          if (env && env.bodyType === "Ping") {
            const now = BigInt(nowMs());
            const echo = BigInt(env.body.clientTimeMs());
            const pong = encodePong((env.env.seq() >>> 0) + 1, now, echo);
            try {
              ws.send(pong);
              wsMsgOut++;
            } catch {}
            return;
          }

          // Плагины: WS-хендлеры (могут перехватить)
          for (const h of pluginWsHandlers) {
            try {
              const handled = h(c.id, message, (bytes) => {
                try {
                  c.ws.send(bytes);
                  wsMsgOut++;
                } catch {}
              });
              if (handled) return;
            } catch {}
          }

          // Форвард в мир
          const ok = writerEnqueue(
            c.toWorld,
            /*type=*/ 1,
            /*flags=*/ 0,
            message
          );
          if (!ok) {
            c.drops++;
            wsDroppedIn++;
            c.violations++;
            if (c.violations >= 3) {
              try {
                ws.close(1008, "backpressure_input");
              } catch {}
            }
          }
        },
        close(ws) {
          const c: ClientState | undefined = (ws as any).__state;
          if (!c) return;
          stopPump(c);
          clients.delete(c.id);
          const cur = ipConn.get(c.ip) ?? 0;
          ipConn.set(c.ip, Math.max(0, cur - 1));
          const msg: ClientCloseMessage = {
            type: "client_close",
            workerType: "gateway",
            index,
            clientId: c.id,
            worldIndex: c.worldIndex,
          };
          post(msg);
        },
      },
    });
    log.info("gateway listening", { port: cfg.port, wsPath: cfg.wsPath });
  });
}

function stopGateway() {
  try {
    server?.stop();
  } catch {}
  server = null;
}
function startHeartbeat(workerIndex: number) {
  const iv = setInterval(() => {
    const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
    post({
      type: "heartbeat",
      workerType: "gateway",
      index: workerIndex,
      uptimeSec,
      rssBytes: memRSS(),
    });
  }, 1000) as unknown as number;
  return () => clearInterval(iv);
}

// @ts-ignore
onmessage = (event: MessageEvent<FromSupervisor | any>) => {
  const data = event.data;
  if (data?.type === "init" && data.workerType === "gateway") {
    const cfg = data.config as GatewayConfig;
    startedAt = Date.now();
    startGateway(cfg, data.index);
    post({ type: "ready", workerType: "gateway", index: data.index });
    (globalThis as any).__stopHB = startHeartbeat(data.index);
  } else if (data?.type === "shutdown") {
    (globalThis as any).__stopHB?.();
    stopGateway();
    setTimeout(() => {
      /* @ts-ignore */
      close();
    }, 50);
  } else if (data?.type === "client_zone_change") {
    const { clientId, worldId } = data as { clientId: string; worldId: number };
    const c = clients.get(clientId);
    if (c) {
      try {
        const buf = encodeServerInfo(0, worldId >>> 0);
        c.ws.send(buf);
        wsMsgOut++;
        c.worldIndex = worldId >>> 0;
      } catch {}
    }
  }
};
