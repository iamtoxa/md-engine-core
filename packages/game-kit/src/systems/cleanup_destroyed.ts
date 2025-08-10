import type { World } from "@iamtoxa/md-engine-ecs-core";
import { makeSystem } from "@iamtoxa/md-engine-ecs-core";

export function makeCleanupDestroyedSystem(Destroyed: any) {
  return makeSystem({
    name: "CleanupDestroyed",
    stage: "post",
    priority: 1000,
    reads: [Destroyed.id],
    writes: [],
    tick(world: World, dt: number) {
      const q = world.query({ with: [Destroyed] });
      for (const eid of q.iterEntities()) {
        world.destroyEntityDeferred({ id: eid, gen: 0 } as any);
      }
    },
  });
}
