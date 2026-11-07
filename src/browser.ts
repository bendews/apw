import bridgeSource from "../ext/bridge.js" with { type: "text" };
import { writeConfig } from "./config.ts";
import { APWError, BROWSER_PROFILE_PATH, EXTENSION_PATH, Status } from "./const.ts";

const HOME = Deno.env.get("HOME")!;
const APPLE_MANIFEST = "/Library/Google/Chrome/NativeMessagingHosts/com.apple.passwordmanager.json";
const EXTENSION_ID = "pejdijmoenmkgeppbflobdenhhabjlaj";
const BACKGROUND = "background.js";
const WEB_STORE_URL = "https://clients2.google.com/service/update2/crx";

export interface Browser {
  id: string;
  name: string;
  bin: string;
  profile: string;
  dataPath: string;
  brewCask: string;
}

function browser(id: string, name: string, app: string, dataDir: string, brewCask: string): Browser {
  return {
    id,
    name,
    bin: `/Applications/${app}.app/Contents/MacOS/${app}`,
    profile: `${BROWSER_PROFILE_PATH}/${id}`,
    dataPath: `${HOME}/Library/Application Support/${dataDir}`,
    brewCask,
  };
}

export const BROWSERS = [
  browser("chromium", "Ungoogled Chromium", "Chromium", "Chromium", "ungoogled-chromium"),
  browser("edge", "Microsoft Edge", "Microsoft Edge", "Microsoft Edge", "microsoft-edge"),
  browser("brave", "Brave", "Brave Browser", "BraveSoftware/Brave-Browser", "brave-browser"),
  browser("chrome", "Google Chrome", "Google Chrome", "Google/Chrome", "google-chrome"),
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
    // macOS can block reading another browser's data folder; treat it like a missing one.
    if (error instanceof Deno.errors.NotFound || error instanceof Deno.errors.PermissionDenied) return [];
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

function copyDirectory(source: string, target: string): void {
  Deno.mkdirSync(target, { recursive: true });
  for (const entry of Deno.readDirSync(source)) {
    const from = `${source}/${entry.name}`;
    const to = `${target}/${entry.name}`;
    if (entry.isDirectory) {
      copyDirectory(from, to);
    } else if (entry.isFile) {
      Deno.copyFileSync(from, to);
    }
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

function browserVersion(browser: Browser): string {
  const { stdout } = new Deno.Command(browser.bin, { args: ["--version"], stdout: "piped", stderr: "null" })
    .outputSync();
  const version = new TextDecoder().decode(stdout).match(/\d+\.\d+/)?.[0];
  if (!version) throw new APWError(Status.GENERIC_ERROR, `Could not read the ${browser.name} version.`);
  return version;
}

async function extensionId(key: string | undefined): Promise<string | undefined> {
  if (!key) return;
  const der = Uint8Array.from(atob(key), (char) => char.charCodeAt(0));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", der));
  return [...hash.subarray(0, 16)].map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join("");
}

async function downloadExtension(browser: Browser, target: string): Promise<void> {
  const fail = (reason: string) =>
    new APWError(Status.GENERIC_ERROR, `Could not download the Apple Passwords extension: ${reason}`);
  const query = new URLSearchParams({
    response: "redirect",
    prodversion: browserVersion(browser),
    acceptformat: "crx3",
    x: `id=${EXTENSION_ID}&uc`,
  });
  const response = await fetch(`${WEB_STORE_URL}?${query}`);
  if (!response.ok) throw fail(`HTTP ${response.status}`);

  const crx = new Uint8Array(await response.arrayBuffer());
  const header = new DataView(crx.buffer, crx.byteOffset, crx.byteLength);
  if (
    crx.byteLength < 12 || new TextDecoder().decode(crx.subarray(0, 4)) !== "Cr24" || header.getUint32(4, true) !== 3
  ) {
    throw fail("not a CRX3 package");
  }

  const temp = Deno.makeTempDirSync({ prefix: "apw-extension-" });
  try {
    Deno.writeFileSync(`${temp}/extension.zip`, crx.subarray(12 + header.getUint32(8, true)));
    const unzip = new Deno.Command("/usr/bin/unzip", {
      args: ["-q", `${temp}/extension.zip`, "-d", target],
      stdout: "null",
      stderr: "piped",
    }).outputSync();
    if (!unzip.success) throw fail(new TextDecoder().decode(unzip.stderr).trim());
  } finally {
    remove(temp);
  }

  const manifest = JSON.parse(Deno.readTextFileSync(`${target}/manifest.json`));
  if (await extensionId(manifest.key) !== EXTENSION_ID) throw fail("its key does not match the extension ID");
}

async function buildExtension(browser: Browser, config: { port: number; token: string }): Promise<void> {
  const background = `${EXTENSION_PATH}/${BACKGROUND}`;
  const orig = `${background}.orig`;

  if (!exists(orig)) {
    const source = extensionSource();
    remove(EXTENSION_PATH);
    Deno.mkdirSync(EXTENSION_PATH, { recursive: true });
    if (source) {
      copyDirectory(source, EXTENSION_PATH);
    } else {
      await downloadExtension(browser, EXTENSION_PATH);
    }
    remove(`${EXTENSION_PATH}/_metadata`);
    Deno.copyFileSync(background, orig);
    const { version } = JSON.parse(Deno.readTextFileSync(`${EXTENSION_PATH}/manifest.json`));
    writeConfig({ extensionVersion: version, extensionPath: source ?? WEB_STORE_URL });
  }

  Deno.writeTextFileSync(
    background,
    `${Deno.readTextFileSync(orig)}\nself.APW_CONFIG = ${JSON.stringify(config)};\n${bridgeSource}\n`,
  );
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
  await buildExtension(browser, config);
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
