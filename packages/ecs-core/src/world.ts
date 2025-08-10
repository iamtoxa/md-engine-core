import { EntityManager } from "./entity";
import { Bitset } from "./bitset";
import { ComponentRegistry } from "./registry";
import { TagStore, SoAStore } from "./component";
import {
  DEFAULT_MAX_COMPONENTS,
  type ComponentDef,
  type ComponentView,
  type SoAComponentDef,
  type TagComponentDef,
} from "./types";
import type { System, Stage } from "./system";
import type { EntityIdObj } from "./id";
import { Resources } from "./resources";
import { EventBus } from "./events";
import { Query } from "./query";

export interface WorldOptions {
  maxEntities?: number;
  maxComponents?: number;
}

export class World {
  readonly entities: EntityManager;
  readonly registry: ComponentRegistry;
  readonly resources = new Resources();
  readonly events = new EventBus();

  private readonly maxEntities: number;
  private readonly wordsPerSignature: number;
  private readonly alive: Uint8Array;
  private readonly signatures: Uint32Array; // [entity][word]
  private readonly stores = new Map<number, TagStore | SoAStore>();
  private systems: System[] = [];
  private toDestroy: EntityIdObj[] = [];

  constructor(opt?: WorldOptions) {
    const maxE = opt?.maxEntities ?? 100_000;
    const maxC = opt?.maxComponents ?? DEFAULT_MAX_COMPONENTS;
    this.entities = new EntityManager(maxE);
    this.registry = new ComponentRegistry(maxC);
    this.maxEntities = maxE;
    this.wordsPerSignature = Math.ceil(maxC / 32);
    this.alive = new Uint8Array(maxE);
    this.signatures = new Uint32Array(maxE * this.wordsPerSignature);
  }

  signatureWords() {
    return this.wordsPerSignature;
  }
  signaturesView() {
    return this.signatures;
  }
  aliveMask() {
    return this.alive;
  }

  addSystem(sys: System) {
    // простая проверка конфликтов (пересечение writes)
    for (const s of this.systems) {
      if (s.stage !== sys.stage) continue;
      if (s.writes.some((w) => sys.writes.includes(w))) {
        // потенциальный конфликт — сейчас просто логируем; позже планировщик сможет параллелить read-only
        // eslint-disable-next-line no-console
        console.warn(
          `[ecs] write conflict between ${s.name} and ${sys.name} on stage ${s.stage}`
        );
      }
    }
    this.systems.push(sys);
    this.systems.sort((a, b) => a.priority - b.priority);
  }

  // Регистрация компонент
  defineTag(name: string): ComponentDef {
    return this.registry.defineTag(name);
  }

  defineSoA(
    name: string,
    fields: ReadonlyArray<{
      name: string;
      type: "f32" | "i32" | "u32" | "f64";
      size: number;
    }>
  ): ComponentDef {
    return this.registry.defineSoA(name, fields as any);
  }

  // Управление сущностями
  createEntity(): EntityIdObj {
    const e = this.entities.create();
    this.alive[e.id] = 1;
    return e;
  }
  destroyEntityDeferred(e: EntityIdObj) {
    if (this.entities.isAlive(e)) this.toDestroy.push(e);
  }
  private flushDestroy() {
    if (this.toDestroy.length === 0) return;
    for (const e of this.toDestroy) {
      // снять компоненты
      const eid = e.id;
      for (const [cid, store] of this.stores) {
        if (store instanceof TagStore) {
          if (store.index.has(eid)) store.remove(eid);
        } else {
          if (store.getIndex(eid) !== -1) store.remove(eid);
        }
        // снять бит в сигнатуре
        const w = cid >>> 5,
          b = cid & 31;
        const off = eid * this.wordsPerSignature;
        this.signatures[off + w]! &= ~(1 << b);
      }
      this.alive[eid] = 0;
      this.entities.destroyImmediate(e);
    }
    this.toDestroy.length = 0;
  }

  // Доступ к хранилищу компонента
  private ensureStore(def: ComponentDef): TagStore | SoAStore {
    let s = this.stores.get(def.id);
    if (!s) {
      s =
        def.kind === "tag"
          ? new TagStore(this.maxEntities)
          : new SoAStore(this.maxEntities, def.fields as any);
      this.stores.set(def.id, s);
    }
    return s;
  }

  componentView(
    def: ComponentDef,
    entityId: number
  ): {
    read(field: string, out?: number[]): number[];
    write(field: string, values: number[] | number): void;
  } | null {
    const store = this.stores.get(def.id);
    if (!store) return null;
    if (store instanceof TagStore) {
      if (!store.index.has(entityId)) return null;
      return {} as any;
    }
    return store.view(entityId);
  }

  // Число сущностей с компонентом (для выбора pivot в запросах)
  componentCount(def: ComponentDef): number {
    const store = this.stores.get(def.id);
    if (!store) return 0;
    return store.size();
  }

  // Итерирование по сущностям, у которых есть компонент
  *iterComponent(def: ComponentDef): IterableIterator<number> {
    const store = this.stores.get(def.id);
    if (!store) return;
    if (store instanceof TagStore) {
      for (const eid of store.iter()) yield eid;
    } else {
      for (const { entityId } of store.iter()) yield entityId;
    }
  }

  // Публичный Query API (без изменений в сигнатуре)
  query(spec: {
    with: ComponentDef[];
    without?: ComponentDef[];
    optional?: ComponentDef[];
  }) {
    const withIds = spec.with.map((d) => d.id);
    const withoutIds = (spec.without ?? []).map((d) => d.id);
    const optionalIds = (spec.optional ?? []).map((d) => d.id);
    return new Query(this, {
      with: withIds,
      without: withoutIds,
      optional: optionalIds,
    });
  }
  addComponent(
    e: EntityIdObj,
    def: ComponentDef,
    init?: Record<string, number[] | number>
  ) {
    if (!this.entities.isAlive(e)) return false;
    const store = this.ensureStore(def);
    const eid = e.id;
    if (store instanceof TagStore) {
      if (!store.index.has(eid)) store.add(eid);
    } else {
      if (store.getIndex(eid) === -1) store.add(eid, init);
    }
    // выставить бит в сигнатуре
    const w = def.id >>> 5,
      b = def.id & 31;
    const off = eid * this.wordsPerSignature;
    this.signatures[off + w]! |= 1 << b;
    return true;
  }

  removeComponent(e: EntityIdObj, def: ComponentDef) {
    if (!this.entities.isAlive(e)) return false;
    const store = this.stores.get(def.id);
    if (!store) return false;
    const eid = e.id;
    if (store instanceof TagStore) {
      if (!store.index.has(eid)) return false;
      store.remove(eid);
    } else {
      if (store.getIndex(eid) === -1) return false;
      store.remove(eid);
    }
    const w = def.id >>> 5,
      b = def.id & 31;
    const off = eid * this.wordsPerSignature;
    this.signatures[off + w]! &= ~(1 << b);
    return true;
  }

  hasComponent(e: EntityIdObj, def: ComponentDef): boolean {
    if (!this.entities.isAlive(e)) return false;
    const eid = e.id;
    const w = def.id >>> 5,
      b = def.id & 31;
    const off = eid * this.wordsPerSignature;
    return (this.signatures[off + w]! & (1 << b)) !== 0;
  }

  // Views
  view(def: ComponentDef, e: EntityIdObj) {
    const store = this.stores.get(def.id);
    if (!store) return null;
    if (store instanceof TagStore) return {}; // у тега нет данных
    return this.componentView(def as any, e.id);
  }

  // Запросы
  createQuery(spec: {
    with: ComponentDef[];
    without?: ComponentDef[];
    optional?: ComponentDef[];
  }) {
    const withIds = spec.with.map((d) => d.id);
    const withoutIds = (spec.without ?? []).map((d) => d.id);
    return new Query(this, { with: withIds, without: withoutIds });
  }

  // Системы
  tick(stage: Stage, dt: number) {
    for (const s of this.systems) {
      if (s.stage !== stage) continue;
      s.tick(this, dt);
    }
    if (stage === "post") {
      this.flushDestroy();
    }
    if (stage === "snapshot") {
      // сбрасываем changed-флаги у всех SoA
      for (const st of this.stores.values()) {
        if (st instanceof SoAStore) st.clearChanged();
      }
    }
  }

  public hasComponentById(def: ComponentDef, entityId: number): boolean {
    if (entityId < 0 || entityId >= this.maxEntities) return false;
    if (this.alive[entityId] !== 1) return false;
    const w = def.id >>> 5,
      b = def.id & 31;
    const off = entityId * this.wordsPerSignature;
    return (this.signatures[off + w]! & (1 << b)) !== 0;
  }

  componentChanged(
    def: import("./types.js").ComponentDef,
    entityId: number
  ): boolean {
    const store = (this as any).stores.get(def.id);
    
    if (!store || !store.changed) return false;
    if (typeof store.getIndex !== "function") return false;

    const idx = store.getIndex(entityId);
    if (idx == null || idx < 0) return false;

    return store.changed[idx] === 1;
  }
}
