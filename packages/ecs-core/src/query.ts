import type {
  ComponentDef,
  ComponentView,
  SoAComponentDef,
  TagComponentDef,
} from "./types.js";
import type { World } from "./world.js";
import { Bitset } from "./bitset.js";

export interface QuerySpec {
  with: number[];
  without?: number[];
  optional?: number[];
}

export class Query {
  private include: Uint32Array;
  private exclude: Uint32Array;

  private pivotComp: number | null = null;

  constructor(private world: World, spec: QuerySpec) {
    const words = world.signatureWords();
    const inc = new Uint32Array(words);
    const exc = new Uint32Array(words);

    for (const c of spec.with) inc[c >>> 5]! |= 1 << (c & 31);

    for (const c of spec.without ?? []) exc[c >>> 5]! |= 1 << (c & 31);

    this.include = inc;
    this.exclude = exc;
    // Выбор "пивота" — компонента с минимальным количеством сущностей
    if (spec.with.length > 0) {
      let bestId = spec.with[0];
      let bestCount = this.world.componentCount({} as any as ComponentDef); // заглушка
      bestCount = Number.POSITIVE_INFINITY;
      for (const cid of spec.with) {
        const count = this.world.componentCount({
          id: cid,
          kind: "tag",
          name: "",
        } as any);
        if (count < bestCount) {
          bestCount = count;
          bestId = cid;
        }
      }
      this.pivotComp = bestId!;
    }
  }

  // Итератор по сущностям (по всем живым; оптимизация: можно перебирать dense из самого редкого компонента)
  *entities(): Iterable<number> {
    const alive = this.world.aliveMask();
    const sigs = this.world.signaturesView();
    const words = this.world.signatureWords();
    for (let eid = 0; eid < alive.length; eid++) {
      if (alive[eid] !== 1) continue;
      const off = eid * words;
      if (
        Bitset.matches(
          sigs.subarray(off, off + words),
          this.include,
          this.exclude
        )
      ) {
        yield eid;
      }
    }
  }

  // Итерация по сущностям, удовлетворяющим маскам
  *iterEntities(): IterableIterator<number> {
    const sigs = this.world.signaturesView();
    const words = this.world.signatureWords();
    const pivot = this.pivotComp;
    if (pivot != null) {
      for (const eid of this.world.iterComponent({
        id: pivot,
        kind: "tag",
        name: "",
      } as any)) {
        const off = eid * words;
        if (
          Bitset.matches(
            sigs.subarray(off, off + words),
            this.include,
            this.exclude
          )
        ) {
          yield eid;
        }
      }
    } else {
      const alive = this.world.aliveMask();
      for (let eid = 0; eid < alive.length; eid++) {
        if (alive[eid] !== 1) continue;
        const off = eid * words;
        if (
          Bitset.matches(
            sigs.subarray(off, off + words),
            this.include,
            this.exclude
          )
        ) {
          yield eid;
        }
      }
    }
  }

  forEach(fn: (entityId: number) => void) {
    for (const eid of this.iterEntities()) fn(eid);
  }

  view(def: ComponentDef, entityId: number) {
    return this.world.componentView(def as any, entityId);
  }

  has(def: ComponentDef, entityId: number) {
    return (this.world).hasComponentById(def, entityId);
  }
}
