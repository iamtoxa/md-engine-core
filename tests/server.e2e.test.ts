test("server entry compiles", async () => {
const mod = await import("../apps/server/src/index.ts")
expect(mod).toBeTruthy()
})