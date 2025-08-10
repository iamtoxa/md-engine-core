// Динамический битсет поверх Uint32Array
export class Bitset {
  readonly words: Uint32Array;
  readonly wordCount: number;
  constructor(wordCount: number, backing?: Uint32Array) {
    this.wordCount = wordCount;
    this.words = backing ?? new Uint32Array(wordCount);
  }
  clear() {
    this.words.fill(0);
  }
  setBit(bit: number) {
    this.words[bit >>> 5]! |= 1 << (bit & 31);
  }
  clearBit(bit: number) {
    this.words[bit >>> 5]! &= ~(1 << (bit & 31));
  }
  hasBit(bit: number) {
    return (this.words[bit >>> 5]! & (1 << (bit & 31))) !== 0;
  }
  // a ⊇ include && a ∩ exclude == ∅
  static matches(
    a: Uint32Array,
    include: Uint32Array,
    exclude: Uint32Array
  ): boolean {
    for (let i = 0; i < a.length; i++) {
      const aw = a[i]!;
      if ((aw & include[i]!) !== include[i]) return false;
      if ((aw & exclude[i]!) !== 0) return false;
    }
    return true;
  }
}
