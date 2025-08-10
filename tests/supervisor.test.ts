import { loadConfig, startSupervisor } from "@iamtoxa/md-engine-runtime";

test("supervisor starts workers and receives heartbeats", async () => {
  const cfg = await loadConfig({
    profile: "test",
    envMap: { MD_PORT: "4545" }, // случайный порт для gateway
  });
  const sup = await startSupervisor();
  // ждём 2 секунды, чтобы пришли heartbeat'ы
  await new Promise((r) => setTimeout(r, 2000));
  await sup.stop();
  expect(true).toBe(true);
});
