export class Resources {
  private map = new Map<string, unknown>();
  set<T>(key: string, value: T) {
    this.map.set(key, value);
  }
  get<T>(key: string): T | undefined {
    return this.map.get(key) as T | undefined;
  }
  has(key: string) {
    return this.map.has(key);
  }
  delete(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}
