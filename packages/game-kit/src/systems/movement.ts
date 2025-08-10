import type { World } from "@iamtoxa/md-engine-ecs-core";
import { makeSystem } from "@iamtoxa/md-engine-ecs-core";
import type { TTransform3D } from "../components/transform3d";
import type { TVelocity3D } from "../components/velocity3d";

export function makeMovementSystem(T: TTransform3D, V: TVelocity3D) {
  return makeSystem({
    name: "Movement3D",
    stage: "simulation",
    priority: 100,
    reads: [T.id, V.id],
    writes: [T.id],
    tick(world: World, dt: number) {
      const q = world.query({ with: [T, V] });
      const pv: number[] = [0, 0, 0];
      const pp: number[] = [0, 0, 0];
      q.forEach((eid) => {
        const vView = q.view(V, eid)!;
        const tView = q.view(T, eid)!;
        vView.read("vel", pv);
        tView.read("pos", pp);
        pp[0]! += pv[0]! * dt;
        pp[1]! += pv[1]! * dt;
        pp[2]! += pv[2]! * dt;
        tView.write("pos", pp);
      });
    },
  });
}
