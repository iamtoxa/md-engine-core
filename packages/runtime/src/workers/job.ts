import { type FromSupervisor, type ToSupervisor } from "../types/control.js";
import { createLogger } from "../logger.js";

interface JobConfig {
  logs: {
    level: "debug" | "info" | "warn" | "error";
    json: boolean;
    pretty: boolean;
  };
}

let startedAt = Date.now();

const log = createLogger({
  name: "worker:job",
  level: "debug",
  json: true,
  pretty: false,
});

function memRSS() {
  try {
    // @ts-ignore node compat
    return Number(process.memoryUsage?.().rss ?? 0);
  } catch {
    return 0;
  }
}

function post(msg: ToSupervisor) {
  // @ts-ignore
  postMessage(msg);
}

function startHeartbeat(workerType: "job", index: number) {
  const iv = setInterval(() => {
    const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
    post({
      type: "heartbeat",
      workerType,
      index,
      uptimeSec,
      rssBytes: memRSS(),
    });
  }, 1000);
  return () => clearInterval(iv);
}

// @ts-ignore
onmessage = (event: MessageEvent<FromSupervisor>) => {
  const data = event.data;
  if (data.type === "init" && data.workerType === "job") {
    startedAt = Date.now();
    post({ type: "ready", workerType: "job", index: data.index });
    const stopHB = startHeartbeat("job", data.index);
    (globalThis as any).__stopHB = stopHB;
  } else if (data.type === "shutdown") {
    (globalThis as any).__stopHB?.();
    setTimeout(() => {
      // @ts-ignore
      close();
    }, 50);
  }
};
