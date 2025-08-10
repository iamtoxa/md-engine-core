import type { FieldSpec } from "./types.js";
import { assert } from "@iamtoxa/md-engine-utils";

// SparseSet для хранения индексов сущностей
class SparseIndex {
  private dense: Uint32Array;
  private sparse: Uint32Array;
  private count = 0;

  constructor(capacity: number) {
    this.dense = new Uint32Array(capacity); // entity id
    this.sparse = new Uint32Array(capacity); // entity id -> dense index + 1
  }

  size() {
    return this.count;
  }
  has(entityId: number): boolean {
    const di = this.sparse[entityId]!;
    return di !== 0 && this.dense[di - 1] === entityId;
  }
  indexOf(entityId: number): number {
    const di = this.sparse[entityId]!;
    if (di === 0) return -1;
    const idx = di - 1;
    return this.dense[idx] === entityId ? idx : -1;
  }

  add(entityId: number): number {
    assert(!this.has(entityId), "duplicate component for entity");
    const idx = this.count++;
    this.dense[idx] = entityId;
    this.sparse[entityId] = idx + 1;
    return idx;
  }

  remove(entityId: number): number {
    const idx = this.indexOf(entityId);
    if (idx === -1) return -1;
    // swap remove
    const lastIdx = this.count - 1;
    const lastEntity = this.dense[lastIdx]!;
    this.dense[idx] = lastEntity;
    this.dense[lastIdx] = 0;
    this.sparse[lastEntity] = idx + 1;
    this.sparse[entityId] = 0;
    this.count--;
    return idx;
  }

  denseAt(i: number) {
    return this.dense[i];
  }
}

// SoA хранение для полей
function allocTyped(
  type: string,
  n: number
): Float32Array | Float64Array | Uint32Array | Int32Array {
  switch (type) {
    case "f32":
      return new Float32Array(n);
    case "f64":
      return new Float64Array(n);
    case "u32":
      return new Uint32Array(n);
    case "i32":
      return new Int32Array(n);
    default:
      throw new Error("unsupported field type");
  }
}

export class SoAStore {
  readonly fields: FieldSpec[];
  readonly data: Record<
    string,
    Float32Array | Float64Array | Uint32Array | Int32Array
  >;
  readonly index: SparseIndex;
  readonly changed: Uint8Array;
  private capacity: number;

  constructor(capacity: number, fields: FieldSpec[]) {
    this.capacity = capacity;
    this.fields = fields;
    this.data = {};
    for (const f of fields) {
      this.data[f.name] = allocTyped(f.type, capacity * f.size);
    }
    this.index = new SparseIndex(capacity);
    this.changed = new Uint8Array(capacity);
  }

  add(entityId: number, init?: Record<string, number[] | number>): number {
    const idx = this.index.add(entityId);
    // Инициализация
    if (init) {
      for (const f of this.fields) {
        const arr = this.data[f.name]!;
        const base = idx * f.size;
        const v = init[f.name];
        if (Array.isArray(v)) {
          for (let i = 0; i < f.size; i++) (arr as any)[base + i] = v[i] ?? 0;
        } else if (typeof v === "number") {
          for (let i = 0; i < f.size; i++) (arr as any)[base + i] = v;
        }
      }
    }
    this.changed[idx] = 1;
    return idx;
  }

  remove(entityId: number): boolean {
    const idx = this.index.indexOf(entityId);
    if (idx === -1) return false;
    this.index.remove(entityId);
    this.changed[idx] = 0;
    // по желанию можно занулить данные (необязательно)
    return true;
  }

  getIndex(entityId: number): number {
    return this.index.indexOf(entityId);
  }

  view(entityId: number) {
    const idx = this.getIndex(entityId);
    if (idx === -1) return null;
    const self = this;
    return {
      read(field: string, out: number[] = []): number[] {
        const spec = self.fields.find((f) => f.name === field);
        if (!spec) throw new Error("field not found");
        const arr = self.data[spec.name]!;
        const base = idx * spec.size;
        out.length = spec.size;
        for (let i = 0; i < spec.size; i++) out[i] = (arr as any)[base + i];
        return out;
      },
      write(field: string, values: number[] | number): void {
        const spec = self.fields.find((f) => f.name === field);
        if (!spec) throw new Error("field not found");
        const arr = self.data[spec.name]!;
        const base = idx * spec.size;
        if (Array.isArray(values)) {
          for (let i = 0; i < spec.size; i++)
            (arr as any)[base + i] = values[i] ?? 0;
        } else {
          for (let i = 0; i < spec.size; i++) (arr as any)[base + i] = values;
        }
        self.changed[idx] = 1;
      },
    };
  }

  size() {
    return this.index.size();
  }

  *iter(): IterableIterator<{ entityId: number; idx: number }> {
    const n = this.index.size();
    for (let i = 0; i < n; i++) {
      const entityId = this.index.denseAt(i)!;
      yield { entityId, idx: i };
    }
  }

  clearChanged() {
    this.changed.fill(0);
  }
}

// Теги: только SparseIndex, без данных
export class TagStore {
  readonly index: SparseIndex;
  constructor(capacity: number) {
    this.index = new SparseIndex(capacity);
  }
  add(entityId: number) {
    this.index.add(entityId);
  }
  remove(entityId: number) {
    this.index.remove(entityId);
  }
  has(entityId: number) {
    return this.index.has(entityId);
  }
  *iter(): IterableIterator<number> {
    const n = this.index.size();
    for (let i = 0; i < n; i++) {
      yield this.index.denseAt(i)!;
    }
  }
  size() { return this.index.size() }
}
