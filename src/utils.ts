import { Buffer } from "node:buffer";
import { QueryStatus } from "./enums.ts";

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

export const toBase64 = (data: any) => toBuffer(data).toString("base64");

export const readBigInt = (buffer: Buffer): bigint => {
  return buffer.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
};

export const sha256 = async (data: any) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", toBuffer(data)));

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

export function throwQueryStatusError(status: QueryStatus): never {
  switch (status) {
    case QueryStatus.SUCCESS:
      throw new Error("Query success");

    case QueryStatus.GENERIC_ERROR:
      throw new Error("Generic query error");

    case QueryStatus.INVALID_PARAM:
      throw new Error("Invalid query param");

    case QueryStatus.NO_RESULTS:
      throw new Error("No query results");

    case QueryStatus.FAILED_TO_DELETE:
      throw new Error("Query failed to delete");

    case QueryStatus.FAILED_TO_UPDATE:
      throw new Error("Query failed to update");

    case QueryStatus.INVALID_MESSAGE_FORMAT:
      throw new Error("Invalid query message format");

    case QueryStatus.DUPLICATE_ITEM:
      throw new Error("Duplicate item in query");

    case QueryStatus.UNKNOWN_ACTION:
      throw new Error("Unknown query action");

    case QueryStatus.INVALID_SESSION:
      throw new Error("Invalid session for query");

    default:
      throw new Error(`Querry error: status code ${status}`);
  }
}
