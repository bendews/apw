import { APWError, DATA_PATH, SOCKET_PATH, Status } from "./const.ts";
import { type Browser, launchBrowser } from "./browser.ts";
import type { APWResponse, Message } from "./types.ts";

const REQUEST_TIMEOUT_MS = 30_000;

type ExtensionMessage = APWResponse | { token: string };

interface Pending {
  id: string;
  resolve: (value: APWResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class ExtensionSession {
  private ws: WebSocket | null = null;
  private pending: Pending | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private token: string) {}

  private rejectPending(error: Error): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(error);
    this.pending = null;
  }

  accept(ws: WebSocket): void {
    if (this.ws) {
      ws.close(4001, "Already connected");
      return;
    }
    ws.addEventListener("message", (event) => {
      let message: ExtensionMessage;
      try {
        message = JSON.parse(event.data as string);
      } catch {
        ws.close(4002, "Bad JSON");
        return;
      }

      if (this.ws !== ws) {
        if (!("token" in message) || message.token !== this.token) {
          ws.close(4003, "Unauthorized");
          return;
        }
        this.ws = ws;
        console.info("[apw] extension connected");
        return;
      }

      if (!("token" in message) && this.pending?.id === message.id) {
        const pending = this.pending;
        this.pending = null;
        clearTimeout(pending.timer);
        pending.resolve(message as APWResponse);
      }
    });

    ws.addEventListener("close", () => {
      this.ws = null;
      this.rejectPending(new Error("Extension disconnected"));
      console.info("[apw] extension disconnected");
    });
  }

  request(message: Message): Promise<APWResponse> {
    const result = this.chain.then(() => {
      const ws = this.ws;
      if (!ws) throw new APWError(Status.INVALID_SESSION);
      return new Promise<APWResponse>((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(
          () => this.rejectPending(new Error("Extension response timed out")),
          REQUEST_TIMEOUT_MS,
        );
        this.pending = { id, resolve, reject, timer };
        ws.send(JSON.stringify({ ...message, id }));
      });
    });
    this.chain = result.catch(() => {});
    return result;
  }
}

async function handleCliConnection(
  conn: Deno.Conn,
  session: { request(message: Message): Promise<APWResponse> },
): Promise<void> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const buf = new Uint8Array(1024 * 64);
  let text = "";
  const send = async (response: APWResponse) => {
    const payload = encoder.encode(`${JSON.stringify(response)}\n`);
    try {
      // conn.write resolves once the socket accepts *some* bytes, and a unix
      // stream socket's send buffer is 8 KiB (net.local.stream.sendspace), so a
      // larger reply has to be written in a loop. Writing it once truncates the
      // JSON mid-string and the client fails to parse at exactly position 8192.
      for (let written = 0; written < payload.length;) {
        const n = await conn.write(payload.subarray(written));
        if (n <= 0) break;
        written += n;
      }
    } catch (e) {
      if ((e as { code?: string }).code !== "EPIPE") throw e;
    }
  };

  try {
    const deadline = setTimeout(() => conn.close(), REQUEST_TIMEOUT_MS);
    try {
      while (!text.includes("\n")) {
        const n = await conn.read(buf);
        if (n === null) break;
        text += decoder.decode(buf.subarray(0, n));
        if (text.length > 1024 * 1024) break;
      }

      const message = JSON.parse(text.split("\n", 1)[0]) as Message;
      if (typeof message.cmd !== "number") {
        throw new APWError(Status.INVALID_PARAM);
      }
      await send(await session.request(message));
    } finally {
      clearTimeout(deadline);
    }
  } catch (error) {
    // Covers the read as well as the request: a client that disconnects or sends
    // a truncated line still gets an answer rather than a bare EOF.
    const err = error as Error;
    await send({
      id: "",
      status: err instanceof APWError ? err.status : Status.SERVER_ERROR,
      error: err.message,
    });
  } finally {
    try {
      conn.close();
    } catch {
      // Already closed by the deadline; not an error worth masking the real one.
    }
  }
}

export async function daemon(browser: Browser): Promise<void> {
  // Before anything is started: taking the socket from a daemon that is already
  // serving would leave it to die in its accept loop with EINVAL and orphan its
  // browser. Checked here so a duplicate start costs nothing.
  try {
    const probe = await Deno.connect({ transport: "unix", path: SOCKET_PATH });
    probe.close();
    throw new APWError(Status.GENERIC_ERROR, "apw is already running.");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound || error instanceof Deno.errors.ConnectionRefused)) {
      throw error;
    }
  }

  Deno.mkdirSync(DATA_PATH, { recursive: true, mode: 0o700 });
  Deno.chmodSync(DATA_PATH, 0o700);

  const token = crypto.randomUUID();
  const session = new ExtensionSession(token);

  const wsServer = Deno.serve({ hostname: "127.0.0.1", port: 0 }, (req) => {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    session.accept(socket);
    return response;
  });

  const child = await launchBrowser(browser, { port: (wsServer.addr as Deno.NetAddr).port, token });
  console.info(`[apw] launched headless ${browser.name}; extension loaded.`);
  const shutdown = async () => {
    try {
      child.kill("SIGTERM");
      await child.status;
    } catch { /* ignore */ }
    try {
      Deno.removeSync(SOCKET_PATH);
    } catch { /* already gone */ }
    Deno.exit(0);
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) Deno.addSignalListener(signal, shutdown);

  try {
    Deno.removeSync(SOCKET_PATH);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const unixListener = Deno.listen({ transport: "unix", path: SOCKET_PATH });
  console.info(`[apw] Unix socket at ${SOCKET_PATH}`);
  await Deno.chmod(SOCKET_PATH, 0o600);

  for await (const conn of unixListener) {
    handleCliConnection(conn, session).catch(console.error);
  }
}
