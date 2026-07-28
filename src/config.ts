import { CONFIG_PATH } from "./const.ts";

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
  Deno.writeTextFileSync(CONFIG_PATH, JSON.stringify({ ...readConfig(), ...patch }, null, 2));
}
