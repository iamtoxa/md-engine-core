export { ConfigSchema, type Config } from "./schema";
export { summarizeConfig, type LoadOptions } from "./load";

import { makeDefaults } from "./defaults";
import { mergeModulesWithEnv } from "./env";
import { ConfigSchema, type Config } from "./schema";

export async function loadConfig(): Promise<Config> {
  const base = makeDefaults(
    process.env.NODE_ENV === "production" ? "prod" : "dev"
  );
  // применяете свои overrides...
  let cfg = ConfigSchema.parse(base);

  // Новое: модули из env (MD_MODULES_CONFIG_FILE) переопределяют cfg.modules
  cfg = { ...cfg, modules: await mergeModulesWithEnv(cfg.modules) };

  return cfg;
}
