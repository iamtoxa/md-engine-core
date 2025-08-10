import type { World } from "@iamtoxa/md-engine-ecs-core";
import { makeSystem } from "@iamtoxa/md-engine-ecs-core";

export type DamageEvent = { entityId: number; amount: number };

export function makeDamageApplySystem(Health: any, Destroyed: any) {
  return makeSystem({
    name: "DamageApply",
    stage: "simulation",
    priority: 40,
    reads: [Health.id],
    writes: [Health.id, Destroyed.id],
    tick(world: World, dt: number) {
      const evts = world.events.drain<DamageEvent>("damage");
      if (evts.length === 0) return;
      const q = world.query({ with: [Health] });
      const hpArr: number[] = [0];
      const maxArr: number[] = [0];
      for (const { entityId, amount } of evts) {
        // проверим, что у сущности есть Health
        if (!q.has(Health, entityId)) continue;
        const hView = q.view(Health, entityId)!;
        hView.read("hp", hpArr);
        hView.read("maxHp", maxArr);
        let hp = hpArr[0]! - Math.max(0, amount);
        hp = Math.max(0, Math.min(hp, maxArr[0] || hp));
        hView.write("hp", [hp]);
        if (hp <= 0) {
          world.addComponent({ id: entityId, gen: 0 } as any, Destroyed);
        }
      }
    },
  });
}
