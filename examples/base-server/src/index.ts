import { BaseGameServer } from "@iamtoxa/md-engine-server";
import { resolve } from "path";

// Пример кастомного сервера с хуками
class MyGameServer extends BaseGameServer {
  protected async onBeforeStart(): Promise<void> {
    // Можно задать переменные окружения перед стартом Supervisor
    // Например, путь до config/modules.json
    process.env.MD_MODULES_CONFIG_FILE ??= resolve(__dirname, "modules.json");
    console.log(
      "[MyGameServer] before start: MD_MODULES_CONFIG_FILE =",
      process.env.MD_MODULES_CONFIG_FILE
    );
  }

  protected async onAfterStart(): Promise<void> {
    console.log("[MyGameServer] after start");
  }

  protected async onBeforeStop(): Promise<void> {
    console.log("[MyGameServer] before stop");
  }

  protected async onAfterStop(): Promise<void> {
    console.log("[MyGameServer] after stop");
  }
}

async function main() {
  const server = new MyGameServer({ autoHandleSignals: true });
  await server.start();

  // Для примера — останавливаемся по таймеру, если нет сигналов
  // setTimeout(() => server.stop(), 5 * 60 * 1000).unref?.()
}

// Bun entry
main().catch((e) => {
  console.error("[base_server] fatal:", e);
  // @ts-ignore
  typeof process !== "undefined" && process.exit && process.exit(1);
});
