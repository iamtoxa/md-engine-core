export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  name: string;
  level: LogLevel;
  json: boolean;
  pretty: boolean;
}

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(opt: LoggerOptions) {
  const enabled = (lvl: LogLevel) => levelOrder[lvl] >= levelOrder[opt.level];
  const ts = () => new Date().toISOString();

  function out(lvl: LogLevel, msg: string, extra?: Record<string, unknown>) {
    if (!enabled(lvl)) return;
    const rec = { level: lvl, ts: ts(), name: opt.name, msg, ...extra };
    if (opt.json && !opt.pretty) {
      console.log(JSON.stringify(rec));
      return;
    }
    if (opt.json && opt.pretty) {
      console.log(JSON.stringify(rec, null, 2));
      return;
    }
    const rest = extra ? " " + JSON.stringify(extra) : "";
    console.log(`[${rec.ts}] ${opt.name} ${lvl.toUpperCase()}: ${msg}${rest}`);
  }

  return {
    debug: (m: string, e?: Record<string, unknown>) => out("debug", m, e),
    info: (m: string, e?: Record<string, unknown>) => out("info", m, e),
    warn: (m: string, e?: Record<string, unknown>) => out("warn", m, e),
    error: (m: string, e?: Record<string, unknown>) => out("error", m, e),
  };
}
