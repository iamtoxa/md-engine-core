type EventHandler<T> = (evt: T) => void;

export class EventBus {
  private queues: Record<string, any[][]> = {};
  // регистрировать тип не обязательно — создаётся лениво

  emit<T>(type: string, evt: T) {
    const q = (this.queues[type] ??= [[], []]);
    q[0]!.push(evt);
  }

  // swap и возврат очереди current
  drain<T>(type: string): T[] {
    const q = (this.queues[type] ??= [[], []]);
    const current = q[0];
    q[0] = q[1]!;
    q[1] = [];
    return current as T[];
  }

  clearAll() {
    for (const t in this.queues) {
      this.queues[t]![0] = [];
      this.queues[t]![1] = [];
    }
  }
}
