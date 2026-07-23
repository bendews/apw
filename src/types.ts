import { Command, Status } from "./const.ts";

export type Message =
  | { cmd: Command.HANDSHAKE; pin?: string }
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
  sites: string[];
  PWD?: string;
}

export interface TOTPEntry {
  code?: string;
  username: string;
  source?: string;
  domain: string;
}

export interface Payload {
  STATUS: Status;
  Entries: Array<PasswordEntry | TOTPEntry>;
}
