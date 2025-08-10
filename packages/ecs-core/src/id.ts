export interface EntityIdObj { id: number; gen: number }
export type EntityKey = number // упакованный 32-бит: id (24) | gen (8) — для быстрых ключей в массивах


export const MAX_ENTITY_ID = 0xfffffe // 24 бита на id (≈ 16.7 млн), 8 бит на generation (0..255)
export function packEntityKey(e: EntityIdObj): EntityKey {
return ((e.id & 0xffffff) | ((e.gen & 0xff) << 24)) >>> 0
}
export function unpackEntityKey(k: EntityKey): EntityIdObj {
return { id: k & 0xffffff, gen: (k >>> 24) & 0xff }
}
export function eqEntity(a: EntityIdObj, b: EntityIdObj): boolean {
return a.id === b.id && a.gen === b.gen
}