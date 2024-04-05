export const DATA_PATH = `${Deno.env.get("HOME")}/.apw`;

export class APWError extends Error {
  code: Status;
  constructor(public status: Status, message?: string) {
    super(message || StatusMap[status]);
    this.code = status;
  }
}

export enum Command {
  END = 0,
  UNUSED = 1,
  HANDSHAKE = 2,
  SET_ICON_AND_TITLE = 3,
  GET_LOGIN_NAMES_FOR_URL = 4,
  GET_PASSWORD_FOR_LOGIN_NAME = 5,
  SET_PASSWORD_FOR_LOGIN_NAME_AND_URL = 6,
  NEW_ACCOUNT_FOR_URL = 7,
  TAB_EVENT = 8,
  PASSWORDS_DISABLED = 9,
  RELOGIN_NEEDED = 10,
  LAUNCH_ICLOUD_PASSWORDS = 11,
  ICLOUD_PASSWORDS_STATE_CHANGE = 12,
  LAUNCH_PASSWORDS_APP = 13,
  GET_CAPABILITIES = 14,
  ONE_TIME_CODE_AVAILABLE = 15,
  GET_ONE_TIME_CODES = 16,
  DID_FILL_ONE_TIME_CODE = 17,
  OPEN_URL_IN_SAFARI = 1984,
}

export enum SecretSessionVersion {
  SRP_WITH_OLD_VERIFICATION = 0,
  SRP_WITH_RFC_VERIFICATION = 1,
}

export enum MSGTypes {
  CLIENT_KEY_EXCHANGE = 0,
  SERVER_KEY_EXCHANGE = 1,
  CLIENT_VERIFICATION = 2,
  SERVER_VERIFICATION = 3,
}

export enum Action {
  UNKNOWN = -1,
  DELETE = 0,
  UPDATE = 1,
  SEARCH = 2,
  ADD_NEW = 3,
  MAYBE_ADD = 4,
  GHOST_SEARCH = 5,
}

export enum Status {
  SUCCESS = 0,
  GENERIC_ERROR = 1,
  INVALID_PARAM = 2,
  NO_RESULTS = 3,
  FAILED_TO_DELETE = 4,
  FAILED_TO_UPDATE = 5,
  INVALID_MESSAGE_FORMAT = 6,
  DUPLICATE_ITEM = 7,
  UNKNOWN_ACTION = 8,
  INVALID_SESSION = 9,
  SERVER_ERROR = 100,
}

export const StatusMap = {
  [Status.SUCCESS]: "Operation successful",
  [Status.GENERIC_ERROR]: "A generic error occurred",
  [Status.INVALID_PARAM]: "Invalid parameter provided",
  [Status.NO_RESULTS]: "No results found",
  [Status.FAILED_TO_DELETE]: "Failed to delete item",
  [Status.FAILED_TO_UPDATE]: "Failed to update item",
  [Status.INVALID_MESSAGE_FORMAT]: "Invalid message format",
  [Status.DUPLICATE_ITEM]: "Duplicate item found",
  [Status.UNKNOWN_ACTION]: "Unknown action requested",
  [Status.INVALID_SESSION]: "Invalid session, reauthenticate with `apw auth`",
  [Status.SERVER_ERROR]: "Server error",
};
