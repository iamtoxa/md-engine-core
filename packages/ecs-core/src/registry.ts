import { assert } from "@iamtoxa/md-engine-utils";
import type { ComponentDef, FieldSpec } from "./types.js";

export class ComponentRegistry {
  private nameToId = new Map<string, number>();
  private defs: ComponentDef[] = [];
  private maxComponents: number;

  constructor(maxComponents: number) {
    this.maxComponents = maxComponents;
  }

  defineTag(name: string): ComponentDef {
    return this.define({ name, kind: "tag", id: -1 });
  }

  defineSoA(name: string, fields: ReadonlyArray<FieldSpec>): ComponentDef {
    return this.define({ name, kind: "soa", id: -1, fields });
  }

  private define(def: ComponentDef): ComponentDef {
    assert(!this.nameToId.has(def.name), "component already defined");
    assert(this.defs.length < this.maxComponents, "max components exceeded");
    const id = this.defs.length;
    const finalDef: ComponentDef = { ...def, id };
    this.nameToId.set(def.name, id);
    this.defs.push(finalDef);
    return finalDef;
  }

  getById(id: number): ComponentDef {
    const d = this.defs[id];
    if (!d) throw new Error("component id not found");
    return d;
  }
  getIdByName(name: string): number {
    const id = this.nameToId.get(name);
    if (id == null) throw new Error("component not found");
    return id;
  }
  count() {
    return this.defs.length;
  }
}
