import { ConfigSchema, type Config, EnvSchema } from "./schema";
import { makeDefaults } from "./defaults";
import { readEnvMap, applyEnvOverrides, type EnvMap } from "./env";

export interface LoadOptions {
  envMap?: EnvMap;
  profile?: "dev" | "prod" | "test";
  cwd?: string;
}

function resolveEnvProfile(opt?: LoadOptions): Config["env"] {
  const fromOpt = opt?.profile;
  const fromEnv = (opt?.envMap?.MD_ENV ?? Bun.env.MD_ENV) as string | undefined;
  const raw = (fromOpt ?? fromEnv ?? "dev").toLowerCase();
  const parsed = EnvSchema.safeParse(raw);
  return parsed.success ? parsed.data : "dev";
}

async function loadFlags(path: string): Promise<unknown> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return {};
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function loadConfig(opt?: LoadOptions): Promise<Config> {
  const profile = resolveEnvProfile(opt);
  const defaults = makeDefaults(profile);

  const work = structuredClone(defaults);
  const env = opt?.envMap ?? readEnvMap();
  applyEnvOverrides(work, env);

  const parsed = ConfigSchema.safeParse(work);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Config validation error: ${issues}`);
  }
  const cfg = parsed.data;

  if (cfg.env === "prod" && cfg.auth.jwt.secret === "dev-secret") {
    throw new Error(
      "MD_JWT_SECRET is required in prod (default dev-secret is not allowed)"
    );
  }

  // Прочитать флаги (best-effort)
  const flags = await loadFlags(cfg.flags.path);
  // Можно сохранить в cfg, если требуется (например, cfg as any). Пока не смешиваем.

  return cfg;
}

export function summarizeConfig(cfg: Config) {
  return {
    env: cfg.env,
    server: {
      host: cfg.server.host,
      port: cfg.server.port,
      wsPath: cfg.server.wsPath,
      restPrefix: cfg.server.restPrefix,
      metricsPath: cfg.server.metricsPath,
      adminPrefix: cfg.server.adminPrefix,
      corsOrigins: cfg.server.corsOrigins,
    },
    simulation: cfg.simulation,
    workers: cfg.workers,
    limits: {
      protocol: cfg.protocolLimits,
      world: cfg.worldLimits,
    },
    logs: cfg.logs,
    metrics: cfg.metrics,
    tracing: cfg.tracing,
  };
}
