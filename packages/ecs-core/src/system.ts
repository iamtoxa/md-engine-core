import type { World } from './world';

export type Stage = "input" | "simulation" | "post" | "snapshot" | "networking";

export interface System {
  name: string;
  stage: Stage;
  priority: number;
  reads: number[];
  writes: number[];
  init?(world: World): void;
  tick(world: World, dt: number): void;
  shutdown?(world: World): void;
}

export function makeSystem(
  spec: Omit<System, "name"> & { name: string }
): System {
  return spec;
}
