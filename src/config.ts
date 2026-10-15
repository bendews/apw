import { CONFIG_PATH, DATA_PATH } from "./const.ts";

export interface Config {
  browser?: string;
  extensionVersion?: string;
  extensionPath?: string;
}

export function readConfig(): Config {
  try {
    return JSON.parse(Deno.readTextFileSync(CONFIG_PATH));
  } catch {
    return {};
  }
}

export function writeConfig(patch: Partial<Config>): void {
  // `apw start --browser` writes config before the daemon creates DATA_PATH, so create it here.
  Deno.mkdirSync(DATA_PATH, { recursive: true, mode: 0o700 });
  Deno.writeTextFileSync(CONFIG_PATH, JSON.stringify({ ...readConfig(), ...patch }, null, 2));
}
