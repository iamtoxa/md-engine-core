import type { World } from "@iamtoxa/md-engine-ecs-core";
import { makeSystem } from "@iamtoxa/md-engine-ecs-core";

function normalize3(v: number[], out: number[] = [0, 0, 0]) {
  const x = v[0] || 0,
    y = v[1] || 0,
    z = v[2] || 0;
  const l = Math.hypot(x, y, z);
  if (l > 1e-6) {
    out[0] = x / l;
    out[1] = y / l;
    out[2] = z / l;
  } else {
    out[0] = out[1] = out[2] = 0;
  }
  return out;
}

export function makeApplyInputSystem(Input: any, Speed: any, Velocity: any) {
  return makeSystem({
    name: "ApplyInput",
    stage: "simulation",
    priority: 50, // раньше Movement
    reads: [Input.id, Speed.id],
    writes: [Velocity.id],
    tick(world: World, dt: number) {
      const q = world.query({ with: [Input, Speed] });
      const mv: number[] = [0, 0, 0];
      const dir: number[] = [0, 0, 0];
      const vel: number[] = [0, 0, 0];
      q.forEach((eid) => {
        const inV = q.view(Input, eid)!;
        const spV = q.view(Speed, eid)!;
        const vV = q.view(Velocity, eid)!;
        inV.read("move", mv);
        const sp = spV.read("speed")[0] || 0;
        normalize3(mv, dir);
        vel[0] = dir[0]! * sp;
        vel[1] = dir[1]! * sp;
        vel[2] = dir[2]! * sp;
        vV.write("vel", vel);
      });
    },
  });
}
