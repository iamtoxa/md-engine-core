import { loadConfig } from "@iamtoxa/md-engine-runtime";

test("config defaults (test profile)", async () => {
  const cfg = await loadConfig({ profile: "test", envMap: {} });
  expect(cfg.env).toBe("test");
  expect(cfg.server.port).toBe(8080);
  expect(cfg.simulation.simulationHz).toBe(30);
});

test("config env overrides", async () => {
  const cfg = await loadConfig({
    profile: "dev",
    envMap: {
      MD_PORT: "9090",
      MD_LOG_LEVEL: "warn",
      MD_CORS: "https://example.com, https://cdn.example.com",
    },
  });
  expect(cfg.server.port).toBe(9090);
  expect(cfg.logs.level).toBe("warn");
  expect(cfg.server.corsOrigins).toEqual([
    "https://example.com",
    "https://cdn.example.com",
  ]);
});
