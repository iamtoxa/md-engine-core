export const pkg = "@iamtoxa/md-engine-ecs-core";
export type EntityId = number;
export function createEntityId(seed = 1): EntityId {
  return seed >>> 0;
}

export * from "./id"
export * from "./bitset"
export * from "./types"
export * from "./registry"
export * from "./component"
export * from "./events"
export * from "./resources"
export * from "./system"
export * from "./world"
export * from "./query"