import {
  loadConfig,
  summarizeConfig,
  startSupervisor,
} from "@iamtoxa/md-engine-runtime";

async function main() {
  const cfg = await loadConfig();
  const summary = summarizeConfig(cfg);
  const pretty = cfg.logs.pretty ? 2 : 0;

  console.log(`[server] Bun ${Bun.version} starting...`);
  console.log(`[server] config: ${JSON.stringify(summary, null, pretty)}`);

  const sup = await startSupervisor();

  const shutdown = async (signal: string) => {
    console.log(`[server] signal ${signal}, shutting down...`);
    try {
      await sup.stop();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[server] fatal:", err);
  process.exit(1);
});
