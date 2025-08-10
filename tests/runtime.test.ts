import { pkg, runtimeHello } from "@iamtoxa/md-engine-runtime"
test("runtime basic", () => {
expect(pkg).toBe("@iamtoxa/md-engine-runtime")
expect(runtimeHello()).toBe("runtime")
})