import { type FromSupervisor } from "../types/control.js";
import { createLogger } from "../logger.js";
import type { ModuleConfig } from "../config/schema.js";

interface JobConfig {
  logs: {
    level: "debug" | "info" | "warn" | "error";
    json: boolean;
    pretty: boolean;
  };
  modules: ModuleConfig[];
}

const log = createLogger({
  name: "worker:job",
  level: "debug",
  json: true,
  pretty: false,
});
const jobs = new Map<
  string,
  (payload: unknown) => Promise<unknown> | unknown
>();
const pluginMetrics = new Map<string, number>();
function metricsCounter(name: string) {
  return {
    inc: (v = 1) => pluginMetrics.set(name, (pluginMetrics.get(name) ?? 0) + v),
  };
}

async function loadJobPlugins(cfg: JobConfig) {
  for (const m of cfg.modules) {
    if (m.target !== "job" && m.target !== "all") continue;
    try {
      const mod = await import(/* @vite-ignore */ m.entry);
      const plugin: import("../ext/types.js").Plugin =
        mod.default ?? mod.plugin ?? mod;
      if (plugin?.init) {
        const ctx: import("../ext/types.js").JobContext = {
          registerJob: (name, handler) => jobs.set(name, handler),
          log: {
            info: (msg, extra) => log.info(msg, extra),
            warn: (msg, extra) => log.warn(msg, extra),
            error: (msg, extra) => log.error(msg, extra),
          },
          metrics: { counter: metricsCounter },
          options: m.options ?? {},
        };
        await plugin.init({ job: ctx });
        log.info("plugin loaded (job)", { name: m.name });
      }
    } catch (e) {
      log.error("plugin load failed (job)", { name: m.name, error: String(e) });
    }
  }
}

// @ts-ignore
onmessage = (ev: MessageEvent<FromSupervisor>) => {
  const data = ev.data;
  if (data?.type === "init" && data.workerType === "job") {
    const cfg = data.config as JobConfig;
    loadJobPlugins(cfg).then(() => {
      // готов к приёму заданий (через control IPC при необходимости)
      // postMessage({ type: "ready", workerType: "job", index: data.index }) — если нужно
    });
  } else if (data?.type === "shutdown") {
    setTimeout(() => {
      /* @ts-ignore */
      close();
    }, 50);
  }
};
