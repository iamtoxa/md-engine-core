import { startSupervisor, type Supervisor } from "@iamtoxa/md-engine-runtime";

export type ServerState =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "stopped";

export type BaseGameServerOptions = {
  autoHandleSignals?: boolean;
};

export class BaseGameServer {
  protected state: ServerState = "idle";
  protected supervisor: Supervisor | null = null;
  protected readonly opts: BaseGameServerOptions;
  private signalBound = false;
  private sigHandler = (sig: NodeJS.Signals) => {
    // eslint-disable-next-line no-console
    console.log(`[BaseGameServer] signal ${sig}, stopping...`);
    this.stop().catch((e) => {
      console.error("[BaseGameServer] graceful stop failed:", e);
      // @ts-ignore
      typeof process !== "undefined" && process.exit && process.exit(1);
    });
  };

  constructor(options: BaseGameServerOptions = {}) {
    this.opts = { autoHandleSignals: true, ...options };
  }

  // Получить текущий Supervisor
  getSupervisor(): Supervisor | null {
    return this.supervisor;
  }

  // Текущее состояние
  getState(): ServerState {
    return this.state;
  }

  // Запуск сервера
  async start(): Promise<void> {
    if (this.state === "running" || this.state === "starting") return;
    this.state = "starting";
    await this.onBeforeStart();
    const sup = await startSupervisor();
    this.supervisor = sup;
    this.state = "running";
    await this.onAfterStart(sup);
    if (this.opts.autoHandleSignals) this.attachSignalHandlers();
    // eslint-disable-next-line no-console
    console.log("[BaseGameServer] started");
  }

  // Остановка сервера
  async stop(): Promise<void> {
    if (
      this.state === "stopped" ||
      this.state === "idle" ||
      this.state === "stopping"
    )
      return;
    this.state = "stopping";
    this.detachSignalHandlers();
    if (this.supervisor) {
      await this.onBeforeStop(this.supervisor);
      try {
        await this.supervisor.stop();
      } catch {}
    }
    this.supervisor = null;
    this.state = "stopped";
    await this.onAfterStop();
    // eslint-disable-next-line no-console
    console.log("[BaseGameServer] stopped");
    // @ts-ignore для совместимости с Bun Worker
    typeof close === "function" && close();
  }

  // Привязать хэндлеры сигналов ОС
  attachSignalHandlers() {
    if (this.signalBound) return;
    try {
      // @ts-ignore
      if (typeof process !== "undefined" && process?.on) {
        // @ts-ignore
        process.on("SIGINT", this.sigHandler);
        // @ts-ignore
        process.on("SIGTERM", this.sigHandler);
        this.signalBound = true;
      }
    } catch {}
  }

  // Отвязать хэндлеры сигналов ОС
  detachSignalHandlers() {
    if (!this.signalBound) return;
    try {
      // @ts-ignore
      if (typeof process !== "undefined" && process?.off) {
        // @ts-ignore
        process.off("SIGINT", this.sigHandler);
        // @ts-ignore
        process.off("SIGTERM", this.sigHandler);
      }
    } catch {}
    this.signalBound = false;
  }

  // Точки расширения (переопределяйте в наследниках)
  // Вызывается перед стартом Supervisor
  // Можно здесь валидировать конфиг, настроить окружение, прогреть ресурсы
  protected async onBeforeStart(): Promise<void> {
    /* no-op */
  }

  // Вызывается сразу после старта Supervisor
  // Здесь можно регистрировать внешние источники, запускать фоновые задачи
  protected async onAfterStart(_sup: Supervisor): Promise<void> {
    /* no-op */
  }

  // Вызывается перед остановкой Supervisor
  protected async onBeforeStop(_sup: Supervisor): Promise<void> {
    /* no-op */
  }

  // Вызывается после полной остановки
  protected async onAfterStop(): Promise<void> {
    /* no-op */
  }
}
