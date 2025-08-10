import { World } from "@iamtoxa/md-engine-ecs-core"


test("add/remove components and signatures", () => {
const w = new World({ maxEntities: 100 })
const T = w.defineSoA("Transform3D", [
{ name: "pos", type: "f32", size: 3 },
{ name: "rot", type: "f32", size: 4 },
{ name: "scale", type: "f32", size: 3 }
])
const R = w.defineTag("Renderable")


const e = w.createEntity()
const ok1 = w.addComponent(e, T, { pos: [1, 2, 3], scale: [1, 1, 1] })
const ok2 = w.addComponent(e, R)
expect(ok1 && ok2).toBe(true)
expect(w.hasComponent(e, T)).toBe(true)
expect(w.hasComponent(e, R)).toBe(true)


const v = w.view(T, e)!
const pos = v.read("pos")
expect(pos).toEqual([1, 2, 3])


const rm = w.removeComponent(e, R)
expect(rm).toBe(true)
expect(w.hasComponent(e, R)).toBe(false)
})