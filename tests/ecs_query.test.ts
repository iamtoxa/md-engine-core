import { World } from "@iamtoxa/md-engine-ecs-core"


test("query with/without", async () => {
const w = new World({ maxEntities: 100 })
const T = w.defineSoA("Transform3D", [
{ name: "pos", type: "f32", size: 3 },
{ name: "rot", type: "f32", size: 4 },
{ name: "scale", type: "f32", size: 3 }
])
const R = w.defineTag("Renderable")
const H = w.defineSoA("Health", [{ name: "hp", type: "u32", size: 1 }])


const e1 = w.createEntity()
w.addComponent(e1, T)
w.addComponent(e1, R)


const e2 = w.createEntity()
w.addComponent(e2, T)
w.addComponent(e2, H, { hp: 100 })


const q = w.query({ with: [T], without: [H] })
const found = Array.from(q.iterEntities())

expect(found).toContain(e1.id)
expect(found).not.toContain(e2.id) })