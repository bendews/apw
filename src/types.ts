export interface RenamedPasswordEntry {
  username: string;
  domain: string;
  password: string;
}

export interface PasswordEntry {
  USR: string;
  sites: string[];
  PWD: string;
}

export interface TOTPEntry {
  code: string;
  username: string;
  source: string;
  domain: string;
}

export interface Payload {
  STATUS: number;
  Entries: PasswordEntry[] | TOTPEntry[];
}

export interface Capabilities {
  canFillOneTimeCodes?: boolean;
  scanForOTPURI?: boolean;
  shouldUseBase64?: boolean;
  operatingSystem?: {
    name: string;
    majorVersion: number;
    minorVersion: number;
  };
}
export interface PAKEMessage {
  TID: string;
  MSG: number;
  A: string;
  s: string;
  B: string;
  VER: string;
  PROTO: number;
}

export interface SMSG {
  SMSG: {
    TID: string;
    SDATA: string;
  };
}

export interface SRPHandshakeMessage {
  QID: string;
  HSTBRSR: string;
  PAKE: PAKEMessage | string;
}

export interface Message {
  cmd: number;
  payload?: SRPHandshakeMessage | string | SMSG;
  msg?: SRPHandshakeMessage | string;
  capabilities?: Capabilities;
  setUpTOTPPageURL?: string;
  setUpTOTPURI?: string;
  url?: string;
  tabId?: number;
  frameId?: number;
}

export interface ManifestConfig {
  name: string;
  description: string;
  path: string;
  type: string;
  allowedOrigins: string[];
}
