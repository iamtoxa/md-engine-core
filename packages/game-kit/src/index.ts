export const pkg = "@iamtoxa/md-engine-game-kit";
export { registerTransform3D } from "./components/transform3d";
export { registerVelocity3D } from "./components/velocity3d";
export { registerInputState } from "./components/input_state";
export { registerMoveSpeed } from "./components/move_speed";
export { registerHealth } from "./components/health";
export {
  registerRenderable,
  registerPlayerControlled,
  registerDestroyed,
} from "./components/tags";
export { makeApplyInputSystem } from "./systems/apply_input";
export { makeMovementSystem } from "./systems/movement";
export { makeDamageApplySystem } from "./systems/damage";
export { makeCleanupDestroyedSystem } from "./systems/cleanup_destroyed";
export { setupGameKit } from "./setup";
export { AOIGrid } from './aoi/grid'