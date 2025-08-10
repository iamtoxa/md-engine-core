import { pkg, version } from "@iamtoxa/md-engine-net"
test("net basic", () => {
expect(pkg).toBe("@iamtoxa/md-engine-net")
expect(version).toBe("0.0.0-dev")
})