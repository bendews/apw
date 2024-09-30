import { Buffer, createSocket } from "./deps.ts";
import {
  Action,
  APWError,
  Command,
  MSGTypes,
  SecretSessionVersion,
  Status,
} from "./const.ts";
import { SRPSession } from "./srp.ts";
import { readBigInt, readConfig, toBase64, toBuffer } from "./utils.ts";
import { type Message, type SMSG } from "./types.ts";
import { writeConfig } from "./utils.ts";

const BROWSER_NAME = "Arc";
const VERSION = "1.0";

export const APWMessages = {
  getCapabilities(): Message {
    return { cmd: Command.GET_CAPABILITIES };
  },

  requestChallenge(session: SRPSession): Message {
    return {
      cmd: Command.HANDSHAKE,
      msg: {
        QID: "m0",
        PAKE: toBase64({
          TID: session.username,
          MSG: MSGTypes.CLIENT_KEY_EXCHANGE,
          A: session.serialize(toBuffer(session.clientPublicKey)),
          VER: VERSION,
          PROTO: [SecretSessionVersion.SRP_WITH_RFC_VERIFICATION],
        }),
        HSTBRSR: BROWSER_NAME,
      },
    };
  },

  async getLoginNamesForURL(
    session: SRPSession,
    url: string,
  ): Promise<Message> {
    const sdataEncrypted = await session.encrypt({
      ACT: Action.GHOST_SEARCH,
      URL: url,
    });
    const sdata = session.serialize(sdataEncrypted);
    return {
      cmd: Command.GET_LOGIN_NAMES_FOR_URL,
      tabId: 1,
      frameId: 1,
      url,
      payload: JSON.stringify({
        QID: "CmdGetLoginNames4URL",
        SMSG: {
          TID: session.username,
          SDATA: sdata,
        },
      }),
    };
  },

  async getPasswordForURL(
    session: SRPSession,
    url: string,
    loginName: string,
  ): Promise<Message> {
    const sdata = session.serialize(
      await session.encrypt({
        ACT: Action.SEARCH,
        URL: url,
        USR: loginName,
      }),
    );
    return {
      cmd: Command.GET_PASSWORD_FOR_LOGIN_NAME,
      tabId: 0,
      frameId: 0,
      url,
      payload: JSON.stringify({
        QID: "CmdGetPassword4LoginName",
        SMSG: {
          TID: session.username,
          SDATA: sdata,
        },
      }),
    };
  },

  async getOTPForURL(
    session: SRPSession,
    url: string,
  ): Promise<Message> {
    const sdata = session.serialize(
      await session.encrypt({
        ACT: Action.SEARCH,
        TYPE: "oneTimeCodes",
        frameURLs: [url],
      }),
    );
    return {
      cmd: Command.DID_FILL_ONE_TIME_CODE,
      tabId: 0,
      frameId: 0,
      payload: JSON.stringify({
        QID: "CmdDidFillOneTimeCode",
        SMSG: {
          TID: session.username,
          SDATA: sdata,
        },
      }),
    };
  },

  async listOTPForURL(
    session: SRPSession,
    url: string,
  ): Promise<Message> {
    const sdata = session.serialize(
      await session.encrypt({
        ACT: Action.GHOST_SEARCH,
        TYPE: "oneTimeCodes",
        frameURLs: [url],
      }),
    );
    return {
      cmd: Command.GET_ONE_TIME_CODES,
      tabId: 0,
      frameId: 0,
      payload: JSON.stringify({
        QID: "CmdDidFillOneTimeCode",
        SMSG: {
          TID: session.username,
          SDATA: sdata,
        },
      }),
    };
  },

  verifyChallenge(
    session: SRPSession,
    m: Buffer,
  ): Message {
    return {
      cmd: Command.HANDSHAKE,
      msg: {
        HSTBRSR: BROWSER_NAME,
        QID: "m2",
        PAKE: toBase64({
          TID: session.username,
          MSG: MSGTypes.CLIENT_VERIFICATION,
          M: session.serialize(m, false),
        }),
      },
    };
  },
};

export class ApplePasswordManager {
  public session: SRPSession;
  private remotePort: number | undefined;
  private challengeTimestamp = 0;

  public async sendMessage(messageContent: Message) {
    const listener = createSocket("udp4");
    listener.bind();
    const content = new TextEncoder().encode(JSON.stringify(messageContent));
    listener.send(content, this.remotePort, "127.0.0.1");
    const data = await new Promise<Uint8Array>((resolve) => {
      listener.once("message", resolve);
    });
    const response = JSON.parse(new TextDecoder().decode(data));
    if ("error" in response) {
      throw new Error(response.error);
    }
    listener.close();
    return response;
  }

  constructor() {
    this.session = SRPSession.new(true);
    writeConfig({});
    const { username, sharedKey, port } = readConfig();
    this.remotePort = port;
    if (typeof sharedKey !== "bigint") return;
    this.session.updateWithValues({ username, sharedKey });
  }

  async decryptPayload(payload: SMSG) {
    if (this.session !== undefined) {
      if (typeof payload.SMSG === "string") {
        payload.SMSG = JSON.parse(payload.SMSG);
      }

      if (payload.SMSG.TID !== this.session.username) {
        throw new Error("Invalid server response: destined to another session");
      }
      try {
        const data = await this.session.decrypt(
          this.session.deserialize(payload.SMSG.SDATA),
        );
        return JSON.parse(data.toString("utf8"));
      } catch (_) {
        throw new Error("Invalid server response: missing payload");
      }
    } else {
      throw new APWError(
        Status.INVALID_SESSION,
        "No session exists. Ensure client is authenticated.",
      );
    }
  }

  async requestChallenge() {
    // Allow to reopen the popup on Windows less than 5s after requesting a challenge
    const challengeTimestamp = Date.now();
    if (this.challengeTimestamp >= challengeTimestamp - 5 * 1000) return;
    this.challengeTimestamp = challengeTimestamp;
    const { payload } = await this.sendMessage(
      APWMessages.requestChallenge(this.session),
    );

    let pake;
    try {
      pake = JSON.parse(Buffer.from(payload.PAKE, "base64").toString("utf8"));
    } catch (_) {
      throw new APWError(
        Status.SERVER_ERROR,
        "Invalid server hello: missing payload",
      );
    }

    if (pake.TID !== this.session.username) {
      throw new APWError(
        Status.SERVER_ERROR,
        "Invalid server hello: destined to another session",
      );
    }

    switch (pake.ErrCode) {
      case undefined:
        break;

      default:
        throw new APWError(
          Status.SERVER_ERROR,
          `Invalid server hello: error code ${pake.ErrCode}`,
        );
    }

    // macOS sends this as a number, but iCloud for Windows as a string
    if (pake.MSG.toString() !== MSGTypes.SERVER_KEY_EXCHANGE.toString()) {
      throw new APWError(
        Status.SERVER_ERROR,
        "Invalid server hello: unexpected message",
      );
    }

    if (pake.PROTO !== SecretSessionVersion.SRP_WITH_RFC_VERIFICATION) {
      throw new APWError(
        Status.SERVER_ERROR,
        "Invalid server hello: unsupported protocol",
      );
    }

    if ("VER" in pake && pake.VER !== VERSION) {
      throw new APWError(
        Status.SERVER_ERROR,
        "Invalid server hello: unsupported version",
      );
    }

    const serverPublicKey = readBigInt(this.session.deserialize(pake.B));
    const salt = readBigInt(this.session.deserialize(pake.s));
    this.session.setServerPublicKey(serverPublicKey, salt);
    return { serverPublicKey, salt };
  }

  async verifyChallenge(password: string) {
    const newKey = await this.session.setSharedKey(password);

    const m = await this.session.computeM();
    const msg = await APWMessages.verifyChallenge(this.session, m);
    const { payload } = await this.sendMessage(msg);

    let pake;
    try {
      pake = JSON.parse(Buffer.from(payload.PAKE, "base64").toString("utf8"));
    } catch (_) {
      throw new APWError(
        Status.SERVER_ERROR,
        "Invalid server verification: missing payload",
      );
    }
    if (pake.TID !== this.session.username) {
      throw new APWError(
        Status.SERVER_ERROR,
        "Invalid server verification: destined to another session",
      );
    }

    // macOS sends this as a number, but iCloud for Windows as a string
    if (pake.MSG.toString() !== MSGTypes.SERVER_VERIFICATION.toString()) {
      throw new APWError(
        Status.SERVER_ERROR,
        "Invalid server verification: unexpected message",
      );
    }

    switch (pake.ErrCode) {
      case 0:
        break;

      case 1:
        throw new Error("Incorrect challenge PIN");

      default:
        throw new APWError(
          Status.SERVER_ERROR,
          `Invalid server verification: error code ${pake.ErrCode}`,
        );
    }

    const hmac = await this.session.computeHMAC(m);
    if (readBigInt(this.session.deserialize(pake.HAMK)) !== readBigInt(hmac)) {
      throw new APWError(
        Status.SERVER_ERROR,
        "Invalid server verification: HAMK mismatch",
      );
    }
    console.log("Challenge verified, updating config");
    await writeConfig({
      username: this.session.username.toString(),
      sharedKey: newKey,
    });
  }

  async getLoginNamesForURL(url: string) {
    const msg = await APWMessages.getLoginNamesForURL(this.session, url);
    const { payload } = await this.sendMessage(msg);
    const response = await this.decryptPayload(payload);
    return response;
  }

  async getPasswordForURL(url: string, loginName?: string) {
    const msg = await APWMessages.getPasswordForURL(
      this.session,
      url,
      loginName || "",
    );
    const { payload } = await this.sendMessage(msg);
    const response = await this.decryptPayload(payload);
    return response;
  }

  async getOTPForURL(url: string) {
    const msg = await APWMessages.getOTPForURL(
      this.session,
      `http://${url}`,
    );
    const { payload } = await this.sendMessage(msg);
    const response = await this.decryptPayload(payload);
    return response;
  }

  async listOTPForURL(url: string) {
    const msg = await APWMessages.listOTPForURL(
      this.session,
      `http://${url}`,
    );
    const { payload } = await this.sendMessage(msg);
    const response = await this.decryptPayload(payload);
    return response;
  }
}
