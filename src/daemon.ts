import { type ManifestConfig } from "./types.ts";
import dgram from "node:dgram";
import { existsSync } from "node:fs";
import { Buffer } from "node:buffer";
import { clearConfig, writeConfig } from "./utils.ts";

export interface UDPSocket {
  data: Buffer;
  rinfo: dgram.RemoteInfo;
}

const readManifest = (): ManifestConfig => {
  const path = [
    "/Library/Application Support/Mozilla/NativeMessagingHosts/com.apple.passwordmanager.json",
    "/Library/Google/Chrome/NativeMessagingHosts/com.apple.passwordmanager.json",
  ].find(existsSync);
  if (!path) {
    throw new Error(
      "APW Helper manifest not found. You must be running macOS 14 or above.",
    );
  }
  const data = Deno.readFileSync(path);
  return JSON.parse(new TextDecoder("utf-8").decode(data));
};

export async function Daemon({ port }: { port: number }) {
  const config = readManifest();
  const cmd = new Deno.Command(config.path, {
    args: ["."],
    stdin: "piped",
    stdout: "piped",
  });
  const process = cmd.spawn();
  console.info("APW helper found & launched.");

  const listener = dgram.createSocket("udp4");
  listener.bind(10000);
  writeConfig({ port: 10000 });
  console.info(`APW Helper Listening on port 10000.`);

  const writer = process.stdin.getWriter();

  clearConfig();

  while (true) {
    const { data, rinfo } = await new Promise<UDPSocket>((resolve) => {
      listener.once("message", (msg, rinfo) => {
        resolve({ data: msg, rinfo });
      });
    });
    const length = new Uint8Array(new Uint32Array([data.length]).buffer);
    const arr = new Uint8Array([...length, ...data]);
    await writer.write(arr);

    const buffer: Uint8Array[] = [];
    const timeout = new Promise<null>((resolve) =>
      setTimeout(resolve, 30000, null)
    );
    const reader = process.stdout.getReader();
    while (true) {
      const result = await Promise.race([reader.read(), timeout]);
      if (result === null) {
        console.error("Command output wait timed out.");
        listener.send('{"error": "timeout"}', rinfo.port, rinfo.address);
        break;
      }
      if (result.done) break;
      buffer.push(result.value);
      try {
        const combinedBuffer = Buffer.concat(buffer).subarray(4);
        JSON.parse(combinedBuffer.toString("utf-8"));
        listener.send(combinedBuffer, rinfo.port, rinfo.address);
        break;
      } catch {
        console.trace("Failed to parse JSON. Continuing to read stdout.");
      }
    }
    reader.releaseLock();
  }
}
