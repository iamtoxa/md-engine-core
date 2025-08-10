export type ZoneId = number;

export interface ZoneBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface ZoneInfo {
  id: ZoneId;
  worldIndex: number; // локальный индекс воркера
  nodeId: string; // идентификатор узла (для мульти-узлов)
  bounds: ZoneBounds;
  version: number;
}
