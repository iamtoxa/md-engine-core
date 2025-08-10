import type { World } from "@iamtoxa/md-engine-ecs-core";
export function registerMoveSpeed(world: World) {
  return world.defineSoA("MoveSpeed", [
    { name: "speed", type: "f32", size: 1 },
  ] as const);
}
