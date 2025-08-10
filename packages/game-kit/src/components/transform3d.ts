import type { World } from "@iamtoxa/md-engine-ecs-core";

export function registerTransform3D(world: World) {
  return world.defineSoA("Transform3D", [
    { name: "pos", type: "f32", size: 3 },
    { name: "rot", type: "f32", size: 4 },
    { name: "scale", type: "f32", size: 3 },
  ] as const);
}

export type TTransform3D = ReturnType<typeof registerTransform3D>;
