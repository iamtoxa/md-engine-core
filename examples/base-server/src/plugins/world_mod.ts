const plugin: import("@iamtoxa/md-engine-runtime").Plugin = {
  meta: { name: "example-world", version: "0.1.0", target: "world" },
  init({ world }) {
    if (!world) return;

    const Score = world.world.defineSoA("mod.Score", [
      { name: "value", type: "u32", size: 1 },
    ] as const);

    world.addSystem({
      name: "ScoreDecay",
      stage: "simulation",
      priority: 500,
      reads: [Score.id],
      writes: [Score.id],
      tick(w, dt) {
        for (const eid of w.iterComponent(Score)) {
          const v = w.componentView(Score, eid)!;
          const cur = v.read("value")[0] || 0;
          v.write("value", [cur > 0 ? cur - 1 : 0]);
        }
      },
    });

    world.registerMessage(100, (clientId, payload) => {
      world.log.info("cmd 100", { clientId, len: payload.byteLength });
    });
  },
};

export default plugin;
