import { readFile } from "fs/promises";
import path from "path";
import { z } from "zod";
import { ModuleSchema, type ModuleConfig } from "./schema.js";
import { pathToFileURL } from "url";

/**
Возвращает абсолютный путь к файлу конфигураций модулей, если он задан.
Берётся из переменной окружения MD_MODULES_CONFIG_FILE. */
export function envGetModulesConfigPath(): string | null {
  const p = (process.env.MD_MODULES_CONFIG_FILE ?? "").trim();
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

/**
Простая проверка на "bare specifier" (npm-пакет), который не надо
преобразовывать в путь. Примеры: "my-mod/plugin", "@scope/pkg/file". */
function isBareSpecifier(spec: string): boolean {
  if (!spec) return false;
  if (spec.startsWith("file://")) return false;
  if (
    spec.startsWith("./") ||
    spec.startsWith("../") ||
    spec.startsWith(".\\") ||
    spec.startsWith("..\\")
  )
    return false;
  if (path.isAbsolute(spec)) return false; // Windows: диск C:...
  if (/^[A-Za-z]:[\/]/.test(spec)) return false; // Иначе считаем bare
  return true;
}

/**
Разрешает entry относительно каталога файла конфигурации.
Абсолютные пути -> file://
Относительные (./, ../) -> file:// относительно baseDir
bare specifier (npm пакет) -> без изменений
уже file:// -> без изменений */
function resolveEntryRelative(entry: string, baseDir: string): string {
  if (!entry) return entry;
  if (entry.startsWith("file://")) return entry;
  if (isBareSpecifier(entry)) return entry;
  if (path.isAbsolute(entry)) {
    return pathToFileURL(entry).href;
  }
  const abs = path.resolve(baseDir, entry);
  return pathToFileURL(abs).href;
}

/**
Загружает и валидирует список модулей из файла, указанного в MD_MODULES_CONFIG_FILE.
Поддерживаем форматы:
массив модулей: [ { name, entry, ... }, ... ]
объект с полем { modules: [...] }
Для каждого модуля entry резолвится относительно директории файла конфигурации.
При ошибках возвращает пустой массив и пишет предупреждение. */
export async function loadModulesFromEnv(): Promise<ModuleConfig[]> {
  const fullPath = envGetModulesConfigPath();
  if (!fullPath) return [];

  let text: string;
  try {
    text = await readFile(fullPath, "utf8");
  } catch (e) {
    console.warn(
      `[env] cannot read MD_MODULES_CONFIG_FILE: ${fullPath}: ${String(e)}`
    );
    return [];
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    console.warn(`[env] invalid JSON in ${fullPath}: ${String(e)}`);
    return [];
  }

  let rawModules: unknown;
  if (Array.isArray(json)) {
    rawModules = json;
  } else if (
    json &&
    typeof json === "object" &&
    Array.isArray((json as any).modules)
  ) {
    rawModules = (json as any).modules;
  } else {
    console.warn(
      `[env] ${fullPath} must be an array of modules or an object with { modules: [...] }`
    );
    return [];
  }

  const parsed = z.array(ModuleSchema).safeParse(rawModules);
  if (!parsed.success) {
    console.warn(
      `[env] modules config validation failed: ${parsed.error.toString()}`
    );
    return [];
  }

  const baseDir = path.dirname(fullPath);
  const modules: ModuleConfig[] = parsed.data.map((m) => ({
    ...m,
    entry: resolveEntryRelative(m.entry, baseDir),
  }));

  return modules;
}

/**
Удобный хелпер для слияния модулей из env с уже имеющимися в конфиге.
Если в env задан файл — он переопределяет список модулей целиком. */
export async function mergeModulesWithEnv(
  existing: ModuleConfig[]
): Promise<ModuleConfig[]> {
  const fromEnv = await loadModulesFromEnv();
  if (fromEnv.length > 0) return fromEnv;
  return existing;
}

function parseBool(v: string | undefined): boolean | undefined {
  if (v == null) return undefined;
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return undefined;
}
function parseIntSafe(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

export type EnvMap = Record<string, string | undefined>;

export function readEnvMap(): EnvMap {
  // Bun.env уже содержит объединённые переменные среды
  // Делаем плоскую копию только нужных ключей (префикс MD_)
  const out: EnvMap = {};
  for (const [k, v] of Object.entries(Bun.env)) {
    if (k.startsWith("MD_")) out[k] = v;
  }
  return out;
}

export function applyEnvOverrides(base: any, env: EnvMap) {
  const get = (k: string) => env[k];

  // env/profile
  if (get("MD_ENV")) base.env = get("MD_ENV");

  // server
  base.server.host = get("MD_HOST") ?? base.server.host;
  base.server.port = parseIntSafe(get("MD_PORT")) || base.server.port;
  base.server.wsPath = get("MD_WS_PATH") ?? base.server.wsPath;
  base.server.restPrefix = get("MD_REST_PREFIX") ?? base.server.restPrefix;
  base.server.metricsPath = get("MD_METRICS_PATH") ?? base.server.metricsPath;
  base.server.adminPrefix = get("MD_ADMIN_PREFIX") ?? base.server.adminPrefix;
  if (get("MD_CORS")) {
    const val = get("MD_CORS")!;
    base.server.corsOrigins =
      val === ""
        ? [""]
        : val
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
  }
  base.server.trustProxy =
    parseBool(get("MD_TRUST_PROXY")) ?? base.server.trustProxy;

  // simulation
  base.simulation.simulationHz =
    parseIntSafe(get("MD_SIM_HZ")) ?? base.simulation.simulationHz;
  base.simulation.networkSnapshotHz =
    parseIntSafe(get("MD_NET_HZ")) ?? base.simulation.networkSnapshotHz;

  // workers
  base.workers.gatewayWorkers =
    parseIntSafe(get("MD_GATEWAY_WORKERS")) ?? base.workers.gatewayWorkers;
  base.workers.worldWorkers =
    parseIntSafe(get("MD_WORLD_WORKERS")) ?? base.workers.worldWorkers;
  base.workers.jobWorkers =
    parseIntSafe(get("MD_JOB_WORKERS")) ?? base.workers.jobWorkers;

  // ipc
  base.ipc.clientInputSabBytes =
    parseIntSafe(get("MD_CLIENT_INPUT_SAB")) ?? base.ipc.clientInputSabBytes;
  base.ipc.clientOutputSabBytes =
    parseIntSafe(get("MD_CLIENT_OUTPUT_SAB")) ?? base.ipc.clientOutputSabBytes;
  base.ipc.controlSabBytes =
    parseIntSafe(get("MD_CONTROL_SAB")) ?? base.ipc.controlSabBytes;

  // protocolLimits
  base.protocolLimits.maxWsFrameBytes =
    parseIntSafe(get("MD_MAX_WS_FRAME")) ?? base.protocolLimits.maxWsFrameBytes;
  base.protocolLimits.maxMessageBytes =
    parseIntSafe(get("MD_MAX_MSG")) ?? base.protocolLimits.maxMessageBytes;
  base.protocolLimits.inputRate.ratePerSec =
    parseIntSafe(get("MD_INPUT_RATE")) ??
    base.protocolLimits.inputRate.ratePerSec;
  base.protocolLimits.inputRate.burst =
    parseIntSafe(get("MD_INPUT_BURST")) ?? base.protocolLimits.inputRate.burst;
  base.protocolLimits.maxConnections =
    parseIntSafe(get("MD_MAX_CONNECTIONS")) ??
    base.protocolLimits.maxConnections;

  // logs
  const logJson = parseBool(get("MD_LOG_JSON"));
  if (logJson !== undefined) base.logs.json = logJson;
  const logPretty = parseBool(get("MD_LOG_PRETTY"));
  if (logPretty !== undefined) base.logs.pretty = logPretty;
  base.logs.level = get("MD_LOG_LEVEL") ?? base.logs.level;

  // metrics & tracing
  const metricsEnabled = parseBool(get("MD_METRICS_ENABLE"));
  if (metricsEnabled !== undefined) base.metrics.enabled = metricsEnabled;
  const tracingEnabled = parseBool(get("MD_TRACING_ENABLE"));
  if (tracingEnabled !== undefined) base.tracing.enabled = tracingEnabled;

  // flags
  base.flags.path = get("MD_FLAGS_PATH") ?? base.flags.path;
  const flagsHot = parseBool(get("MD_FLAGS_HOT"));
  if (flagsHot !== undefined) base.flags.hotReload = flagsHot;

  // auth
  base.auth.jwt.secret = get("MD_JWT_SECRET") ?? base.auth.jwt.secret;
  base.auth.jwt.accessTtl = get("MD_JWT_ACCESS_TTL") ?? base.auth.jwt.accessTtl;
  base.auth.jwt.refreshTtl =
    get("MD_JWT_REFRESH_TTL") ?? base.auth.jwt.refreshTtl;

  // worldLimits
  base.worldLimits.softMaxEntitiesPerWorld =
    parseIntSafe(get("MD_WORLD_SOFT_MAX_ENTITIES")) ??
    base.worldLimits.softMaxEntitiesPerWorld;
  base.worldLimits.softMaxPlayersPerWorld =
    parseIntSafe(get("MD_WORLD_SOFT_MAX_PLAYERS")) ??
    base.worldLimits.softMaxPlayersPerWorld;
  base.worldLimits.splitTrigger.p99TickMs =
    parseIntSafe(get("MD_WORLD_SPLIT_P99_MS")) ??
    base.worldLimits.splitTrigger.p99TickMs;
  base.worldLimits.splitTrigger.consecutiveTicks =
    parseIntSafe(get("MD_WORLD_SPLIT_CONSEC")) ??
    base.worldLimits.splitTrigger.consecutiveTicks;
}
