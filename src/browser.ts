import bridgeSource from "../ext/bridge.js" with { type: "text" };
import { writeConfig } from "./config.ts";
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

function buildExtension(config: { port: number; token: string }): void {
  const background = `${EXTENSION_PATH}/${BACKGROUND}`;
  const orig = `${background}.orig`;

  if (!exists(orig)) {
    const source = extensionSource();
    if (!source) {
      throw new APWError(
        Status.GENERIC_ERROR,
        "Apple Passwords extension not found. Install it from the Chrome Web Store.",
      );
    }
    remove(EXTENSION_PATH);
    Deno.mkdirSync(EXTENSION_PATH, { recursive: true });
    copyDirectory(source, EXTENSION_PATH);
    remove(`${EXTENSION_PATH}/_metadata`);
    Deno.copyFileSync(background, orig);
    writeConfig({ extensionVersion: source.split("/").at(-1)!, extensionPath: source });
  }

  Deno.writeTextFileSync(
    background,
    `${Deno.readTextFileSync(orig)}\nself.APW_CONFIG = ${JSON.stringify(config)};\n${bridgeSource}\n`,
  );
}

export function installedBrowsers(): Browser[] {
  return BROWSERS.filter(({ bin }) => exists(bin));
}

// DevTools over --remote-debugging-pipe: the browser reads commands from fd 3 and writes replies to fd 4,
// each message a JSON string terminated by "\0". Only the process holding the pipe can drive the browser,
// unlike --remote-debugging-port, which any local process (or user) can connect to.
async function loadExtension(child: Deno.ChildProcess): Promise<void> {
  const writer = child.stdin.getWriter();
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const response = (async () => {
    await writer.write(
      new TextEncoder().encode(
        `${JSON.stringify({ id: 1, method: "Extensions.loadUnpacked", params: { path: EXTENSION_PATH } })}\0`,
      ),
    );
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Browser closed the DevTools pipe");
      buffer += decoder.decode(value, { stream: true });
      for (let end = buffer.indexOf("\0"); end !== -1; end = buffer.indexOf("\0")) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (message.id === 1) {
          if (message.error) throw new Error(message.error.message);
          return;
        }
      }
    }
  })();
  response.catch(() => {}); // settled via the race below; avoids an unhandled rejection after a timeout

  try {
    await Promise.race([
      response,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Extensions.loadUnpacked timed out")), 15_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    writer.releaseLock();
    reader.releaseLock();
  }

  // Keep the command pipe open for the browser's lifetime, and drain its output so it never blocks on fd 4.
  child.stdout.pipeTo(new WritableStream()).catch(() => {});
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

  // Deno can't hand a child extra file descriptors, so a shell maps the child's stdin/stdout onto fds 3/4
  // and then execs the browser (same PID, so child.kill still reaches it).
  const child = new Deno.Command("/bin/sh", {
    args: [
      "-c",
      'exec "$0" "$@" 3<&0 4>&1 </dev/null >/dev/null',
      browser.bin,
      `--user-data-dir=${browser.profile}`,
      "--remote-debugging-pipe",
      "--enable-unsafe-extension-debugging",
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  }).spawn();

  try {
    await loadExtension(child);
    return child;
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
}
