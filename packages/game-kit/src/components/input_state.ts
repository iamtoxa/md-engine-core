import type { World } from "@iamtoxa/md-engine-ecs-core";

export function registerInputState(world: World) {
  // move/look: -1..1; buttons: битовая маска; seq — номер последнего входного пакета
  return world.defineSoA("InputState", [
    { name: "move", type: "f32", size: 3 },
    { name: "look", type: "f32", size: 3 },
    { name: "buttons", type: "u32", size: 1 },
    { name: "analog1", type: "f32", size: 1 },
    { name: "analog2", type: "f32", size: 1 },
    { name: "seq", type: "u32", size: 1 },
  ] as const);
}
