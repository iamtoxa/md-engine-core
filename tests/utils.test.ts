import { pkg, clamp } from "@iamtoxa/md-engine-utils"
test("utils basic", () => {
expect(pkg).toBe("@iamtoxa/md-engine-utils")
expect(clamp(5, 0, 3)).toBe(3)
})