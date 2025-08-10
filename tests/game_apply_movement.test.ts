import { World } from "@iamtoxa/md-engine-ecs-core"
import { setupGameKit } from "@iamtoxa/md-engine-game-kit"


test("apply input then movement updates position", () => {
const w = new World({ maxEntities: 100 })
const { Transform3D, Velocity3D, InputState, MoveSpeed } = setupGameKit(w)


const e = w.createEntity()
w.addComponent(e, Transform3D, { pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1] })
w.addComponent(e, Velocity3D, { vel: [0, 0, 0] })
w.addComponent(e, InputState, { move: [1, 0, 0], look: [1, 0, 0], buttons: 0, analog1: 0, analog2: 0, seq: 1 })
w.addComponent(e, MoveSpeed, { speed: 5 })


// Один тик simulation: ApplyInput (priority 50) затем Movement (priority 100)
w.tick("simulation", 1.0)


const tView = w.componentView(Transform3D, e.id)!
const pos = tView.read("pos")
expect(pos[0]).toBeCloseTo(5, 5)
expect(pos[1]).toBeCloseTo(0, 5)
expect(pos[2]).toBeCloseTo(0, 5)
})