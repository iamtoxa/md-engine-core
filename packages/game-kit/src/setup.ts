import type { World } from "@iamtoxa/md-engine-ecs-core";
import { registerTransform3D } from "./components/transform3d";
import { registerVelocity3D } from "./components/velocity3d";
import { registerInputState } from "./components/input_state";
import { registerMoveSpeed } from "./components/move_speed";
import { registerHealth } from "./components/health";
import {
  registerRenderable,
  registerPlayerControlled,
  registerDestroyed,
} from "./components/tags";
import { makeApplyInputSystem } from "./systems/apply_input";
import { makeMovementSystem } from "./systems/movement";
import { makeDamageApplySystem } from "./systems/damage";
import { makeCleanupDestroyedSystem } from "./systems/cleanup_destroyed";

export interface GameKitOptions {
  defaultSpeed?: number;
  enableDamage?: boolean;
}

export function setupGameKit(world: World, opt: GameKitOptions = {}) {
  const Transform3D = registerTransform3D(world);
  const Velocity3D = registerVelocity3D(world);
  const InputState = registerInputState(world);
  const MoveSpeed = registerMoveSpeed(world);
  const Health = registerHealth(world);
  const Renderable = registerRenderable(world);
  const PlayerControlled = registerPlayerControlled(world);
  const Destroyed = registerDestroyed(world);

  // Если нужен дефолтный спид — можно выставлять при создании сущностей (через addComponent)
  // Системы
  world.addSystem(makeApplyInputSystem(InputState, MoveSpeed, Velocity3D));
  world.addSystem(makeMovementSystem(Transform3D, Velocity3D));
  if (opt.enableDamage !== false) {
    world.addSystem(makeDamageApplySystem(Health, Destroyed));
  }
  world.addSystem(makeCleanupDestroyedSystem(Destroyed));

  return {
    Transform3D,
    Velocity3D,
    InputState,
    MoveSpeed,
    Health,
    Renderable,
    PlayerControlled,
    Destroyed,
  };
}
