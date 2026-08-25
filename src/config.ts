import { CONFIG_PATH, DATA_PATH } from "./const.ts";

export interface Config {
  browser?: string;
  extensionVersion?: string;
  extensionPath?: string;
  /** Set false to stop `find` remembering the hostnames it reaches. */
  recall?: boolean;
}

export function readConfig(): Config {
  try {
    return JSON.parse(Deno.readTextFileSync(CONFIG_PATH));
  } catch {
    return {};
  }
}

export function writeConfig(patch: Partial<Config>): void {
  // Nothing else guarantees the directory exists: only the daemon created it,
  // so a setting changed before the first start failed with a raw errno.
  Deno.mkdirSync(DATA_PATH, { recursive: true, mode: 0o700 });
  Deno.writeTextFileSync(CONFIG_PATH, JSON.stringify({ ...readConfig(), ...patch }, null, 2));
}
