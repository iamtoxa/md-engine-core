import { pkg, createEntityId } from "@iamtoxa/md-engine-ecs-core"


test("ecs-core basic", () => {
expect(pkg).toBe("@iamtoxa/md-engine-ecs-core")
expect(createEntityId(42)).toBe(42)
})