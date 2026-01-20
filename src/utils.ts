// deno-lint-ignore-file no-explicit-any
import { Buffer } from "./deps.ts";
import { DATA_PATH } from "./const.ts";
import { APWConfig } from "./types.ts";

export const toBuffer = (data: any): Buffer => {
  if (Buffer.isBuffer(data)) return data;

  switch (typeof data) {
    case "number":
      return toBuffer(BigInt(data));

    case "bigint": {
      const array = [];
      while (data > 0n) {
        array.unshift(Number(data & 0xffn));
        data >>= 8n;
      }
      return Buffer.from(new Uint8Array(array));
    }

    case "string":
      return Buffer.from(data, "utf8");

    case "boolean":
    case "symbol":
    case "undefined":
    case "object":
    case "function":
      return toBuffer(JSON.stringify(data));
  }
};

export const toBufferSource = (data: any) => {
  const buffer = toBuffer(data);
  return new Uint8Array(buffer);
};

export const toBase64 = (data: any) => toBuffer(data).toString("base64");

export const readBigInt = (buffer: Buffer): bigint => {
  return buffer.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
};

export const sha256 = async (data: any) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", toBufferSource(data)));

export const pad = (buffer: Buffer, length: number) => {
  const array = Buffer.alloc(length);
  array.set(buffer.subarray(0, length), Math.max(length - buffer.length, 0));
  return array;
};

export const mod = (A: bigint, N: bigint) => {
  A %= N;
  if (A < 0) A += N;
  return A;
};

export const powermod = (g: bigint, x: bigint, N: bigint): bigint => {
  if (x < 0n) throw new Error("Unsupported negative exponents");

  const _powermod = (x: bigint): bigint => {
    if (x === 0n) return 1n;
    let r = _powermod(x >> 1n) ** 2n;
    if ((x & 1n) === 1n) r *= g;
    return mod(r, N);
  };

  return _powermod(x);
};

export function randomBytes(count: number) {
  const array = new Uint8Array(count);
  crypto.getRandomValues(array);
  return Buffer.from(array);
}

export const clearConfig = async () => {
  try {
    await Deno.remove(`${DATA_PATH}/config.json`);
  } catch (_) {
    return;
  }
};

export const writeConfig = (
  { username, sharedKey, port }: {
    username?: string;
    sharedKey?: bigint;
    port?: number;
  },
) => {
  let existingConfig: APWConfig;
  Deno.mkdirSync(DATA_PATH, { recursive: true });
  try {
    existingConfig = JSON.parse(
      Deno.readTextFileSync(`${DATA_PATH}/config.json`),
    );
  } catch (_) {
    existingConfig = { sharedKey: "", username: "" };
  }
  const updatedConfig: APWConfig = {
    ...existingConfig,
    username: username || existingConfig.username,
    sharedKey: sharedKey ? toBase64(sharedKey) : existingConfig.sharedKey,
    port: port || existingConfig.port || 10000,
  };
  Deno.writeTextFileSync(
    `${DATA_PATH}/config.json`,
    JSON.stringify(updatedConfig),
  );
};

export const readConfig = () => {
  try {
    const content = Deno.readTextFileSync(`${DATA_PATH}/config.json`);
    const config: APWConfig = JSON.parse(content);
    return {
      sharedKey: config.sharedKey &&
        readBigInt(Buffer.from(config.sharedKey, "base64")),
      username: config.username,
      port: config.port,
    };
  } catch (_) {
    throw new Error(
      "No existing keys. Please login first.",
    );
  }
};
