import { Command, Status } from "./const.ts";

export type Message =
  | { cmd: Command.HANDSHAKE; pin?: string }
  | { cmd: Command.GET_CAPABILITIES }
  | {
    cmd: number;
    qid: string;
    tabId: number;
    frameId: number;
    url?: string;
    body: unknown;
  };

export type DecryptedData = { STATUS: number } & Record<string, unknown>;

export type APWResponse =
  | { id: string; data: DecryptedData }
  | { id: string; status: Status; error?: string };

export interface PasswordEntry {
  USR: string;
  PWD?: string;
  sites: string[];
  highLevelDomain?: string;
  customTitle?: string;
  CDate?: string;
  ModDate?: string;
}

export interface TOTPEntry {
  code?: string;
  username: string;
  domain: string;
  source?: string;
}

export interface Payload {
  STATUS: Status;
  Entries: Array<PasswordEntry | TOTPEntry>;
  RequiresUserAuthenticationToFill?: boolean;
}
