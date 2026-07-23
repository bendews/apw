import { Action, APWError, Command, SOCKET_PATH, Status } from "./const.ts";
import type { APWResponse, DecryptedData, Message, PasswordEntry, Payload, TOTPEntry } from "./types.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function readLine(conn: Deno.Conn): Promise<string> {
  const buf = new Uint8Array(64 * 1024);
  let text = "";
  while (!text.includes("\n")) {
    const n = await conn.read(buf);
    if (n === null) break;
    text += decoder.decode(buf.subarray(0, n));
  }
  return text.split("\n", 1)[0];
}

export const APWMessages = {
  getLoginNamesForURL(url: string): Message {
    return {
      cmd: Command.GET_LOGIN_NAMES_FOR_URL,
      qid: "CmdGetLoginNames4URL",
      tabId: 1,
      frameId: 1,
      url,
      body: { ACT: Action.GHOST_SEARCH, URL: url },
    };
  },

  getPasswordForURL(url: string, loginName = ""): Message {
    return {
      cmd: Command.GET_PASSWORD_FOR_LOGIN_NAME,
      qid: "CmdGetPassword4LoginName",
      tabId: 0,
      frameId: 0,
      url,
      body: { ACT: Action.SEARCH, URL: url, USR: loginName },
    };
  },

  saveAccountForURL(url: string, loginName: string, password: string): Message {
    return {
      cmd: Command.SET_PASSWORD_FOR_LOGIN_NAME_AND_URL,
      qid: "CmdSetPassword4LoginName_URL",
      tabId: 0,
      frameId: 0,
      body: {
        ACT: Action.MAYBE_ADD,
        URL: "",
        USR: "",
        PWD: "",
        NURL: url,
        NUSR: loginName,
        NPWD: password,
      },
    };
  },

  getOTPForURL(url: string): Message {
    return {
      cmd: Command.DID_FILL_ONE_TIME_CODE,
      qid: "CmdDidFillOneTimeCode",
      tabId: 0,
      frameId: 0,
      body: {
        ACT: Action.SEARCH,
        TYPE: "oneTimeCodes",
        frameURLs: [url.includes("://") ? url : `http://${url}`],
      },
    };
  },

  listOTPForURL(url: string): Message {
    return {
      cmd: Command.GET_ONE_TIME_CODES,
      qid: "CmdDidFillOneTimeCode",
      tabId: 0,
      frameId: 0,
      body: {
        ACT: Action.GHOST_SEARCH,
        TYPE: "oneTimeCodes",
        frameURLs: [url.includes("://") ? url : `http://${url}`],
      },
    };
  },
};

export function entriesFrom(data: DecryptedData): unknown[] {
  if (!data || typeof data.STATUS !== "number") {
    throw new APWError(Status.SERVER_ERROR);
  }
  if (data.STATUS === Status.NO_RESULTS) return [];
  if (data.STATUS !== Status.SUCCESS) {
    throw new APWError(data.STATUS as Status);
  }
  if (Array.isArray(data.Entries)) return data.Entries;
  return Object.entries(data)
    .filter(([key]) => key.startsWith("Entry_"))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, value]) => value);
}

export class ApplePasswordManager {
  private async sendMessage(message: Message): Promise<APWResponse> {
    let conn: Deno.Conn;
    try {
      conn = await Deno.connect({ transport: "unix", path: SOCKET_PATH });
    } catch {
      throw new APWError(Status.INVALID_SESSION);
    }

    try {
      await conn.write(encoder.encode(`${JSON.stringify(message)}\n`));
      const response = JSON.parse(await readLine(conn)) as APWResponse;
      if (!("data" in response) && response.status !== Status.SUCCESS) {
        throw new APWError(response.status, response.error);
      }
      return response;
    } finally {
      conn.close();
    }
  }

  private async getPayload(message: Message): Promise<Payload> {
    const response = await this.sendMessage(message);
    if (!("data" in response)) throw new APWError(Status.SERVER_ERROR);
    return {
      STATUS: response.data.STATUS as Status,
      Entries: entriesFrom(response.data) as Array<PasswordEntry | TOTPEntry>,
    };
  }

  async requestChallenge(): Promise<void> {
    await this.sendMessage({ cmd: Command.HANDSHAKE });
  }

  async verifyChallenge(pin: string): Promise<void> {
    await this.sendMessage({ cmd: Command.HANDSHAKE, pin });
  }

  getLoginNamesForURL(url: string): Promise<Payload> {
    return this.getPayload(APWMessages.getLoginNamesForURL(url));
  }

  getPasswordForURL(url: string, loginName?: string): Promise<Payload> {
    return this.getPayload(APWMessages.getPasswordForURL(url, loginName));
  }

  saveAccountForURL(url: string, loginName: string, password: string): Promise<Payload> {
    return this.getPayload(APWMessages.saveAccountForURL(url, loginName, password));
  }

  getOTPForURL(url: string): Promise<Payload> {
    return this.getPayload(APWMessages.getOTPForURL(url));
  }

  listOTPForURL(url: string): Promise<Payload> {
    return this.getPayload(APWMessages.listOTPForURL(url));
  }
}
