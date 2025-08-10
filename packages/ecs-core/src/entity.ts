import { MAX_ENTITY_ID, type EntityIdObj } from "./id.js";
import { assert } from "@iamtoxa/md-engine-utils";

export class EntityManager {
  private capacity: number;
  private alive: Uint8Array;
  private generation: Uint8Array;
  private freeList: number[] = [];
  private count = 0;

  constructor(capacity: number) {
    assert(
      capacity > 0 && capacity <= MAX_ENTITY_ID,
      "Invalid entity capacity"
    );
    this.capacity = capacity;
    this.alive = new Uint8Array(capacity);
    this.generation = new Uint8Array(capacity); // 0..255
  }

  size() {
    return this.count;
  }
  max() {
    return this.capacity;
  }
  isAlive(e: EntityIdObj): boolean {
    if (e.id < 0 || e.id >= this.capacity) return false;
    return this.alive[e.id] === 1 && this.generation[e.id] === (e.gen & 0xff);
  }

  create(): EntityIdObj {
    let id = this.freeList.length ? this.freeList.pop()! : -1;
    if (id === -1) {
      id = this.count;
      assert(id < this.capacity, "Entity capacity exceeded");
    }
    this.alive[id] = 1;
    const gen = this.generation[id]! & 0xff;
    this.count++;
    return { id, gen };
  }

  destroyImmediate(e: EntityIdObj): boolean {
    if (!this.isAlive(e)) return false;
    this.alive[e.id] = 0;
    this.count--;
    this.generation[e.id] = (this.generation[e.id]! + 1) & 0xff;
    this.freeList.push(e.id);
    return true;
  }
}
