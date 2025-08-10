import type { World } from "@iamtoxa/md-engine-ecs-core";
export function registerRenderable(world: World) {
  return world.defineTag("Renderable");
}
export function registerPlayerControlled(world: World) {
  return world.defineTag("PlayerControlled");
}
export function registerDestroyed(world: World) {
  return world.defineTag("Destroyed");
}
