import type { World } from "@iamtoxa/md-engine-ecs-core";
export function registerHealth(world: World) {
  return world.defineSoA("Health", [
    { name: "hp", type: "u32", size: 1 },
    { name: "maxHp", type: "u32", size: 1 },
  ] as const);
}
