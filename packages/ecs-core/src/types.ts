// Ограничение компонент
export const DEFAULT_MAX_COMPONENTS = 1024; // можно увеличить при создании мира
export type ComponentKind = "tag" | "soa";

export type FieldType = "f32" | "i32" | "u32" | "f64";
export interface FieldSpec {
  name: string;
  type: FieldType;
  size: number; // длина в элементах (например, vec3=3)
}

export interface ComponentDef {
  name: string;
  kind: ComponentKind;
  id: number;
  // важно: readonly, чтобы сохранить литеральные имена при передаче as const
  fields?: ReadonlyArray<FieldSpec>;
}

// Специализации для перегрузок
export type TagComponentDef = ComponentDef & { kind: "tag" };
export type SoAComponentDef = ComponentDef & {
  kind: "soa";
  fields: ReadonlyArray<FieldSpec>;
};

// Получить union имён полей из Def
export type FieldNames<Def extends SoAComponentDef> =
  Def["fields"] extends ReadonlyArray<infer F>
    ? F extends { name: infer N }
      ? N extends string
        ? N
        : never
      : never
    : never;

// Тип вью для SoA-компонента
export type SoAView<Def extends SoAComponentDef> = {
  read<K extends FieldNames<Def>>(field: K, out?: number[]): number[];
  write<K extends FieldNames<Def>>(field: K, values: number[] | number): void;
};

// Итоговый тип возвращаемого значения componentView
export type ComponentView<Def extends ComponentDef> =
  Def extends TagComponentDef
    ? {}
    : Def extends SoAComponentDef
    ? SoAView<Def>
    : never;
