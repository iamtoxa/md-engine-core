/* SPSC кольцевой буфер на SharedArrayBuffer.
Заголовок буфера (Int32Array, индексы в байтах, рабочая область = dataCapacity):
[0]=dataCapacity, [1]=readIndex, [2]=writeIndex, [3]=writeNotify, [4]=readNotify
Сообщение: len:u32, type:u16, flags:u16, payload(N), pad до 4 байт.
*/

const I_CAP = 0;
const I_READ = 1;
const I_WRITE = 2;
const I_WNOTIFY = 3;
const I_RNOTIFY = 4;
const HEADER_I32_WORDS = 5;
const HEADER_BYTES = HEADER_I32_WORDS * 4;

const MSG_HEADER_BYTES = 8;

export type RingMessage = {
  type: number; // u16
  flags: number; // u16 (bit0 = droppable)
  payload: Uint8Array; // view, zero-copy
};

export interface RingShared {
  sab: SharedArrayBuffer;
}

export interface Ring {
  sab: SharedArrayBuffer;
  i32: Int32Array;
  u8: Uint8Array;
  view: DataView;
  dataCapacity: number;
  dataOffset: number;
}

export function createRing(capacityBytes: number): RingShared {
  if (!Number.isFinite(capacityBytes) || capacityBytes <= 1024) {
    throw new Error("capacityBytes must be > 1024");
  }
  const total = HEADER_BYTES + capacityBytes;
  const sab = new SharedArrayBuffer(total);
  const i32 = new Int32Array(sab, 0, HEADER_I32_WORDS);
  Atomics.store(i32, I_CAP, capacityBytes);
  Atomics.store(i32, I_READ, 0);
  Atomics.store(i32, I_WRITE, 0);
  Atomics.store(i32, I_WNOTIFY, 0);
  Atomics.store(i32, I_RNOTIFY, 0);
  return { sab };
}

export function attachRing(sab: SharedArrayBuffer): Ring {
  const i32 = new Int32Array(sab, 0, HEADER_I32_WORDS);
  const dataCapacity = Atomics.load(i32, I_CAP);
  const u8 = new Uint8Array(sab, HEADER_BYTES, dataCapacity);
  const view = new DataView(sab, HEADER_BYTES, dataCapacity);
  return {
    sab,
    i32,
    u8,
    view,
    dataCapacity,
    dataOffset: HEADER_BYTES,
  };
}

function pad4(n: number) {
  const r = n & 3;
  return r === 0 ? n : n + (4 - r);
}

function spaceFree(cap: number, read: number, write: number) {
  // оставляем 1 байт для различения full/empty
  if (write >= read) return cap - (write - read) - 1;
  return read - write - 1;
}

export function writerEnqueue(
  ring: Ring,
  type: number,
  flags: number,
  data: Uint8Array
): boolean {
  const cap = ring.dataCapacity;
  const i32 = ring.i32;
  const view = ring.view;

  const len = data.byteLength >>> 0;
  const need = MSG_HEADER_BYTES + pad4(len);
  if (need + 1 > cap) {
    // сообщение слишком большое
    return false;
  }

  while (true) {
    const read = Atomics.load(i32, I_READ);
    let write = Atomics.load(i32, I_WRITE);
    let free = spaceFree(cap, read, write);
    if (free < need) {
      // нет места — неблокирующий режим: не пишем
      return false;
    }
    // убедимся, что заголовок+payload помещаются до конца
    const contiguous = cap - write;
    if (contiguous < need) {
      // перенос указателя записи в 0 (заполняем gap как занятый)
      // это безопасно в SPSC: consumer при чтении проверит остаток и сделает wrap
      Atomics.store(i32, I_WRITE, 0);
      // уведомим читателя (чтобы он мог сделать wrap, если ждал)
      Atomics.add(i32, I_WNOTIFY, 1);
      Atomics.notify(i32, I_WNOTIFY, 1);
      continue;
    }

    // Запись заголовка
    view.setUint32(write, len, true);
    view.setUint16(write + 4, type & 0xffff, true);
    view.setUint16(write + 6, flags & 0xffff, true);
    // Запись payload
    ring.u8.set(data, write + MSG_HEADER_BYTES);
    // Нули для padding
    const padded = pad4(len);
    const padBytes = padded - len;
    if (padBytes) {
      ring.u8.fill(
        0,
        write + MSG_HEADER_BYTES + len,
        write + MSG_HEADER_BYTES + padded
      );
    }

    // Публикуем запись (release)
    const newWrite = write + MSG_HEADER_BYTES + padded;
    Atomics.store(i32, I_WRITE, newWrite >= cap ? 0 : newWrite);
    // Разбудить читателя
    Atomics.add(i32, I_WNOTIFY, 1);
    Atomics.notify(i32, I_WNOTIFY, 1);
    return true;
  }
}

export function readerDequeue(ring: Ring): RingMessage | null {
  const cap = ring.dataCapacity;
  const i32 = ring.i32;
  const view = ring.view;
  let read = Atomics.load(i32, I_READ);
  const write = Atomics.load(i32, I_WRITE);

  if (read === write) {
    return null; // пусто
  }

  // Если не хватает места даже на заголовок — перенос на 0
  const contiguous = cap - read;
  if (contiguous < MSG_HEADER_BYTES) {
    read = 0;
    Atomics.store(i32, I_READ, 0);
  }

  // Перечитать write на случай wrap
  const write2 = Atomics.load(i32, I_WRITE);
  if (read === write2) return null;

  const len = view.getUint32(read, true);
  const type = view.getUint16(read + 4, true);
  const flags = view.getUint16(read + 6, true);

  const total = MSG_HEADER_BYTES + pad4(len);
  // Гарантированно влезает в конец (producer обеспечил contiguous >= need)
  const payloadStart = read + MSG_HEADER_BYTES;
  const payload = new Uint8Array(ring.sab, ring.dataOffset + payloadStart, len);

  // Продвинуть read (release для symmetry; consumer — единственный писатель READ)
  const newRead = read + total;
  Atomics.store(i32, I_READ, newRead >= cap ? 0 : newRead);
  // Разбудить писателя
  Atomics.add(i32, I_RNOTIFY, 1);
  Atomics.notify(i32, I_RNOTIFY, 1);

  return { type, flags, payload };
}

export function ringStats(ring: Ring) {
  const cap = ring.dataCapacity;
  const read = Atomics.load(ring.i32, I_READ);
  const write = Atomics.load(ring.i32, I_WRITE);
  const used = write >= read ? write - read : cap - (read - write);
  const free = spaceFree(cap, read, write);
  return { cap, read, write, used, free };
}

export const RingFlags = {
  Droppable: 1 << 0,
} as const;
