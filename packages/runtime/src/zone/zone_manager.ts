import type { ZoneBounds, ZoneInfo, ZoneId } from "./types.js";

export class ZoneManager {
  readonly nodeId: string;
  private zones: ZoneInfo[] = [];

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  // Простая инициализация: разбиваем по X на N зон шириной width
  initLinearX(count: number, width: number): ZoneInfo[] {
    this.zones = [];
    for (let i = 0; i < count; i++) {
      const z: ZoneInfo = {
        id: i,
        worldIndex: i,
        nodeId: this.nodeId,
        bounds: {
          minX: i * width,
          maxX: (i + 1) * width,
          minY: -1e9,
          maxY: 1e9,
          minZ: -1e9,
          maxZ: 1e9,
        },
        version: 1,
      };
      this.zones.push(z);
    }
    return this.zones;
  }

  allZones(): ZoneInfo[] {
    return this.zones.slice();
  }
  getByWorldIndex(idx: number): ZoneInfo | undefined {
    return this.zones.find((z) => z.worldIndex === idx);
  }
  getById(id: ZoneId): ZoneInfo | undefined {
    return this.zones.find((z) => z.id === id);
  }

  // По позиции определяем зону (по X)
  zoneByPosition(x: number, y: number, z: number): ZoneInfo | undefined {
    return this.zones.find((zz) => x >= zz.bounds.minX && x < zz.bounds.maxX);
  }

  // Вычисление соседней зоны при выходе за границы
  neighborForExit(
    current: ZoneInfo,
    pos: { x: number; y: number; z: number }
  ): ZoneInfo | undefined {
    if (pos.x < current.bounds.minX) return this.getById(current.id - 1);
    if (pos.x >= current.bounds.maxX) return this.getById(current.id + 1);
    // Y/Z пока не режем (бесконечные)
    return undefined;
  }
}
