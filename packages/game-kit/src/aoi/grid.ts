export class AOIGrid {
  constructor(public readonly cellSize: number) {}

  private cell(x: number, y: number, z: number) {
    return {
      cx: Math.floor(x / this.cellSize),
      cy: Math.floor(y / this.cellSize),
      cz: Math.floor(z / this.cellSize),
    };
  }
  private key(cx: number, cy: number, cz: number) {
    return `${cx},${cy},${cz}`;
  }

  private entityCell = new Map<number, string>();
  private cellEntities = new Map<string, Set<number>>();

  upsert(entityId: number, x: number, y: number, z: number) {
    const { cx, cy, cz } = this.cell(x, y, z);
    const k = this.key(cx, cy, cz);
    const prev = this.entityCell.get(entityId);
    if (prev === k) return;
    if (prev) {
      const s = this.cellEntities.get(prev);
      if (s) {
        s.delete(entityId);
        if (s.size === 0) this.cellEntities.delete(prev);
      }
    }
    this.entityCell.set(entityId, k);
    let s = this.cellEntities.get(k);
    if (!s) this.cellEntities.set(k, (s = new Set()));
    s.add(entityId);
  }

  remove(entityId: number) {
    const prev = this.entityCell.get(entityId);
    if (!prev) return;
    const s = this.cellEntities.get(prev);
    if (s) {
      s.delete(entityId);
      if (s.size === 0) this.cellEntities.delete(prev);
    }
    this.entityCell.delete(entityId);
  }

  // Возвращает список кандидатов из соседних клеток (без точной фильтрации по радиусу)
  queryCells(
    x: number,
    y: number,
    z: number,
    radius: number,
    out: number[] = []
  ): number[] {
    out.length = 0;
    const cs = this.cellSize;
    const { cx, cy, cz } = this.cell(x, y, z);
    const cr = Math.ceil(radius / cs);
    for (let dx = -cr; dx <= cr; dx++) {
      for (let dy = -cr; dy <= cr; dy++) {
        for (let dz = -cr; dz <= cr; dz++) {
          const s = this.cellEntities.get(this.key(cx + dx, cy + dy, cz + dz));
          if (!s) continue;
          for (const eid of s) out.push(eid);
        }
      }
    }
    return out;
  }
}
