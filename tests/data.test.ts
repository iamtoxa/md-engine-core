import { pkg, pingDataLayer } from "@iamtoxa/md-engine-data"
test("data basic", () => {
expect(pkg).toBe("@iamtoxa/md-engine-data")
expect(pingDataLayer()).toBe("ok")
})