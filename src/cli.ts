import { Buffer, Command, Input, Select, ValidationError } from "./deps.ts";
import { Daemon } from "./daemon.ts";
import { ApplePasswordManager } from "./client.ts";
import { readBigInt, toBase64 } from "./utils.ts";
import {
  type Payload,
  type RenamedPasswordEntry,
  type TOTPEntry,
} from "./types.ts";
import { APWError, Status, VERSION } from "./const.ts";

const PrintEntries = (payload: Payload) => {
  if (payload.STATUS !== Status.SUCCESS) {
    throw new APWError(payload.STATUS);
  }
  const entries = payload.Entries.map((entry) => {
    if ("USR" in entry) {
      return {
        username: entry.USR,
        domain: entry.sites[0],
        password: entry.PWD || "Not Included",
      } as RenamedPasswordEntry;
    } else if ("code" in entry) {
      return {
        username: entry.username,
        domain: entry.domain,
        code: entry.code || "Not Included",
      } as TOTPEntry;
    }
  });
  console.log(JSON.stringify({ results: entries, status: Status.SUCCESS }));
};

const client = new ApplePasswordManager();

const otp = new Command()
  .description("Interactively list accounts/OTPs.")
  .action(async () => {
    const action: string = await Select.prompt({
      message: "Choose an action: ",
      options: ["list OTPs", "get OTPs"],
    });
    const url = await Input.prompt({
      message: "Enter URL: ",
    });
    if (action === "list OTPs") {
      PrintEntries(await client.listOTPForURL(url));
    } else if (action === "get OTPs") {
      PrintEntries(await client.getOTPForURL(url));
    }
  })
  .command("get", "Get a OTP for a website.")
  .arguments("<url:string>")
  .action(async (_, url: string) => {
    if (!url) {
      throw new Error("Missing required argument 'url'.");
    }
    PrintEntries(await client.getOTPForURL(url));
  })
  .command("list", "List available OTPs for a website.")
  .arguments("<url:string>")
  .action(async (_, url: string) => {
    if (!url) {
      throw new Error("Missing required argument 'url'.");
    }
    PrintEntries(await client.listOTPForURL(url));
  });

const pw = new Command()
  .description("Interactively list accounts/passwords.")
  .action(async () => {
    const action: string = await Select.prompt({
      message: "Choose an action: ",
      options: ["list accounts", "get password"],
    });
    const url = await Input.prompt({
      message: "Enter URL: ",
    });
    if (action === "list accounts") {
      PrintEntries(await client.getLoginNamesForURL(url));
    } else if (action === "get password") {
      PrintEntries(await client.getPasswordForURL(url));
    }
  })
  .command("get", "Get a password for a website.")
  .arguments("<url:string> [username:string]")
  .action(async (_, url: string, username?: string) => {
    if (!url) {
      throw new Error("Missing required argument 'url'.");
    }
    PrintEntries(await client.getPasswordForURL(url, username));
  })
  .command("list", "List available accounts for a website.")
  .arguments("<url:string>")
  .action(async (_, url: string) => {
    if (!url) {
      throw new Error("Missing required argument 'url'.");
    }
    PrintEntries(await client.getLoginNamesForURL(url));
  });

const daemon = new Command()
  .description("Start the daemon.")
  .option("-p, --port <port:number>", "Port to listen on.", { default: 0 })
  .action(Daemon);

const auth = new Command()
  .description("Authenticate CLI with daemon.")
  .action(async () => {
    await client.requestChallenge();
    const password = await Input.prompt({
      message: "Enter PIN: ",
      minLength: 6,
      maxLength: 6,
    });
    await client.verifyChallenge(password);
  })
  .command("request", "Request a challenge from the daemon.")
  .action(async () => {
    await client.requestChallenge();
    const srpValues = client.session.returnValues({
      salt: true,
      serverPublicKey: true,
      username: true,
      clientPrivateKey: true,
    });
    console.log(JSON.stringify({
      salt: toBase64(srpValues.salt),
      serverKey: toBase64(srpValues.serverPublicKey),
      username: srpValues.username,
      clientKey: toBase64(srpValues.clientPrivateKey),
    }));
  })
  .command("response", "Respond to a challenge from the daemon.")
  .option("-p, --pin <pin>", "challenge-response pin.", { required: true })
  .option("-s, --salt <salt>", "request salt.", { required: true })
  .option("-sk, --serverKey <serverKey>", "server public key.", {
    required: true,
  })
  .option("-ck, --clientKey <clientKey>", "client public key.", {
    required: true,
  })
  .option("-u, --username <username>", "client username.", { required: true })
  .action(async (options) => {
    const { serverKey, salt, username, clientKey, pin } = options;
    const serverPublicKey = readBigInt(Buffer.from(serverKey, "base64"));
    const clientPrivateKey = readBigInt(Buffer.from(clientKey, "base64"));
    const saltResponse = readBigInt(Buffer.from(salt, "base64"));
    client.session.updateWithValues({
      username,
      salt: saltResponse,
      clientPrivateKey,
      serverPublicKey,
    });
    await client.verifyChallenge(pin);
    console.log(JSON.stringify({ status: Status.SUCCESS }));
  });

await new Command()
  .name("apw-cli")
  .version(`v${VERSION}`)
  .description("🔑 a CLI for Apple Passwords 🔒")
  .command("auth", auth)
  .command("pw", pw)
  .command("otp", otp)
  .command("start", daemon)
  .error((error, cmd) => {
    if (error instanceof ValidationError) {
      cmd.showHelp();
    }
    console.error(error);
    Deno.exit(error instanceof ValidationError ? error.exitCode : 1);
  })
  .parse(Deno.args);
