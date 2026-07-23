import bridgeSource from "../ext/bridge.js" with { type: "text" };
import { APWError, BROWSER_PROFILE_PATH, EXTENSION_PATH, Status } from "./const.ts";

const HOME = Deno.env.get("HOME")!;
const APPLE_MANIFEST = "/Library/Google/Chrome/NativeMessagingHosts/com.apple.passwordmanager.json";
const EXTENSION_ID = "pejdijmoenmkgeppbflobdenhhabjlaj";
const BACKGROUND = "background.js";

export interface Browser {
  id: string;
  name: string;
  bin: string;
  profile: string;
  dataPath: string;
}

function browser(id: string, name: string, app: string, dataDir: string): Browser {
  return {
    id,
    name,
    bin: `/Applications/${app}.app/Contents/MacOS/${app}`,
    profile: `${BROWSER_PROFILE_PATH}/${id}`,
    dataPath: `${HOME}/Library/Application Support/${dataDir}`,
  };
}

const BROWSERS = [
  browser("chromium", "Ungoogled Chromium", "Chromium", "Chromium"),
  browser("chrome", "Google Chrome", "Google Chrome", "Google/Chrome"),
  browser("brave", "Brave", "Brave Browser", "BraveSoftware/Brave-Browser"),
  browser("edge", "Microsoft Edge", "Microsoft Edge", "Microsoft Edge"),
];

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

function directories(path: string): string[] {
  try {
    return [...Deno.readDirSync(path)].filter((entry) => entry.isDirectory).map((entry) => entry.name);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
}

function remove(path: string): void {
  try {
    Deno.removeSync(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

function extensionSource(): string | undefined {
  for (const { dataPath } of BROWSERS) {
    for (const profile of directories(dataPath)) {
      const base = `${dataPath}/${profile}/Extensions/${EXTENSION_ID}`;
      const version = directories(base).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
      if (!version) continue;
      const path = `${base}/${version}`;
      if (exists(`${path}/${BACKGROUND}`)) return path;
    }
  }
}

function buildExtension(config: { port: number; token: string }): void {
  const source = extensionSource();
  if (!source) {
    throw new APWError(
      Status.GENERIC_ERROR,
      "Apple Passwords extension not found. Install it from the Chrome Web Store.",
    );
  }

  remove(EXTENSION_PATH);
  Deno.mkdirSync(EXTENSION_PATH, { recursive: true });

  const copied = new Deno.Command("cp", { args: ["-R", `${source}/.`, EXTENSION_PATH] }).outputSync().success;
  if (!copied) throw new APWError(Status.GENERIC_ERROR, "Failed to copy the extension.");

  const background = `${EXTENSION_PATH}/${BACKGROUND}`;
  const original = Deno.readTextFileSync(background);
  remove(`${EXTENSION_PATH}/_metadata`);
  Deno.writeTextFileSync(background, `${original}\nself.APW_CONFIG = ${JSON.stringify(config)};\n${bridgeSource}\n`);
}

export function installedBrowsers(): Browser[] {
  return BROWSERS.filter(({ bin }) => exists(bin));
}

async function debuggerUrl(port: number): Promise<string> {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  for (let attempt = 0; attempt < 60; attempt++) {
    const data = await fetch(endpoint).then((response) => response.json()).catch(() => ({}));
    if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Browser DevTools endpoint did not start");
}

async function loadExtension(port: number): Promise<void> {
  const socket = new WebSocket(await debuggerUrl(port));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Extensions.loadUnpacked timed out")), 15_000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        error ? reject(error) : resolve();
      };
      socket.onerror = () => finish(new Error("DevTools connection failed"));
      socket.onopen = () =>
        socket.send(JSON.stringify({
          id: 1,
          method: "Extensions.loadUnpacked",
          params: { path: EXTENSION_PATH },
        }));
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string);
        if (message.id === 1) finish(message.error && new Error(message.error.message));
      };
    });
  } finally {
    socket.close();
  }
}

export async function launchBrowser(
  browser: Browser,
  config: { port: number; token: string },
): Promise<Deno.ChildProcess> {
  buildExtension(config);
  remove(browser.profile);
  const hosts = `${browser.profile}/NativeMessagingHosts`;
  Deno.mkdirSync(hosts, { recursive: true });
  Deno.copyFileSync(APPLE_MANIFEST, `${hosts}/com.apple.passwordmanager.json`);

  const port = 9500 + Math.floor(Math.random() * 400);
  const child = new Deno.Command(browser.bin, {
    args: [
      `--user-data-dir=${browser.profile}`,
      `--remote-debugging-port=${port}`,
      "--remote-allow-origins=*",
      "--enable-unsafe-extension-debugging",
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
    ],
    stdout: "null",
    stderr: "null",
  }).spawn();

  try {
    await loadExtension(port);
    return child;
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
}
