import type { World } from "@iamtoxa/md-engine-ecs-core";

export function registerVelocity3D(world: World) {
  return world.defineSoA("Velocity3D", [
    { name: "vel", type: "f32", size: 3 },
  ] as const);
}

export type TVelocity3D = ReturnType<typeof registerVelocity3D>;
