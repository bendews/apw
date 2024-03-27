import { type ManifestConfig } from "./types.ts";
import dgram from "node:dgram";
import { Buffer } from "node:buffer";

export interface UDPSocket {
  data: Buffer;
  rinfo: dgram.RemoteInfo;
}

const readManifest = (path: string): ManifestConfig => {
  const data = Deno.readFileSync(path);
  return JSON.parse(new TextDecoder("utf-8").decode(data));
};

export async function Daemon({ port }: { port: number }) {
  const config = readManifest(
    "/Library/Google/Chrome/NativeMessagingHosts/com.apple.passwordmanager.json",
  );
  const cmd = new Deno.Command(config.path, {
    args: ["."],
    stdin: "piped",
    stdout: "piped",
  });
  const process = cmd.spawn();
  console.log("APW helper found & launched.");

  const listener = dgram.createSocket("udp4");
  listener.bind(port);
  console.log(`APW Helper Listening on port ${port}.`);

  const writer = process.stdin.getWriter();
  const reader = process.stdout.getReader();

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
      setTimeout(resolve, 5000, null)
    );

    while (true) {
      const result = await Promise.race([reader.read(), timeout]);
      if (result === null) {
        console.log("Command output wait timed out.");
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
  }
}
