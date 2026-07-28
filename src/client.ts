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

  async newAccountForURL(
    session: SRPSession,
    url: string,
    loginName: string,
    password: string,
  ): Promise<Message> {
    const sdata = session.serialize(
      await session.encrypt({
        ACT: Action.MAYBE_ADD,
        URL: String(),
        USR: String(),
        PWD: String(),
        NURL: url,
        NUSR: loginName,
        NPWD: password,
      }),
    );

    return {
      cmd: Command.NEW_ACCOUNT_FOR_URL,
      tabId: 0,
      frameId: 0,
      payload: JSON.stringify({
        QID: "CmdNewAccount4URL",
        SMSG: {
          TID: session.username,
          SDATA: sdata,
        },
      }),
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

  async checkReady(): Promise<void> {
    try {
      await this.sendMessage({ cmd: Command.GET_CAPABILITIES });
    } catch (error) {
      if (error instanceof APWError && error.status === Status.INVALID_SESSION) {
        if (error.message === "unpaired") {
          throw new APWError(Status.INVALID_SESSION, "APW is not authorised. Run `apw auth` to pair.");
        }
        throw new APWError(Status.INVALID_SESSION, "APW is not running. Start it with `apw start`.");
      }
    }
  }

  async requestChallenge(): Promise<void> {
    await this.sendMessage({ cmd: Command.HANDSHAKE });
  }

  async verifyChallenge(pin: string): Promise<void> {
    await this.sendMessage({ cmd: Command.HANDSHAKE, pin });
  }

  getLoginNamesForURL(url: string): Promise<Payload> {
    if (!url) throw new APWError(Status.INVALID_PARAM, "URL is required");
    return this.getPayload(APWMessages.getLoginNamesForURL(url));
  }

  getPasswordForURL(url: string, loginName?: string): Promise<Payload> {
    if (!url) throw new APWError(Status.INVALID_PARAM, "URL is required");
    return this.getPayload(APWMessages.getPasswordForURL(url, loginName));
  }

  async saveAccountForURL(url: string, loginName: string, password: string): Promise<void> {
    if (!url) throw new APWError(Status.INVALID_PARAM, "URL is required");
    const response = await this.sendMessage(APWMessages.saveAccountForURL(url, loginName, password));
    if ("status" in response && response.status !== Status.SUCCESS) {
      throw new APWError(response.status, response.error);
    }
  }

  getOTPForURL(url: string): Promise<Payload> {
    if (!url) throw new APWError(Status.INVALID_PARAM, "URL is required");
    return this.getPayload(APWMessages.getOTPForURL(url));
  }

  listOTPForURL(url: string): Promise<Payload> {
    if (!url) throw new APWError(Status.INVALID_PARAM, "URL is required");
    return this.getPayload(APWMessages.listOTPForURL(url));
  }
  async saveAccountForURL(url: string, loginName: string, password: string) {
    const msg = await APWMessages.newAccountForURL(
      this.session,
      url,
      loginName,
      password,
    );
    const { payload } = await this.sendMessage(msg);
    const response = await this.decryptPayload(payload);

    if (response.STATUS !== Status.SUCCESS) {
      throw new APWError(response.STATUS);
    }
    console.log("Account saved successfully."); 
  }

}
