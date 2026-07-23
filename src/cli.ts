import { Command, Input, Secret, Select } from "./deps.ts";
import { Daemon } from "./daemon.ts";
import { ApplePasswordManager } from "./client.ts";
import { installedBrowsers } from "./browser.ts";
import { APWError, Status, VERSION } from "./const.ts";
import type { Payload } from "./types.ts";

const client = new ApplePasswordManager();

const PrintSuccess = () => console.log(JSON.stringify({ status: Status.SUCCESS }));

const PrintEntries = (payload: Payload) => {
  const entries = payload.Entries.map((entry) => {
    if ("USR" in entry) {
      return {
        username: entry.USR,
        domain: entry.sites[0],
        password: entry.PWD || "Not Included",
      };
    } else {
      return {
        username: entry.username,
        domain: entry.domain,
        code: entry.code || "Not Included",
      };
    }
  });
  console.log(JSON.stringify({ results: entries, status: Status.SUCCESS }));
};

const otp = new Command()
  .description("Interactively list accounts/OTPs.")
  .action(async () => {
    const action: string = await Select.prompt({
      message: "Choose an action: ",
      options: ["list OTPs", "get OTPs"],
    });
    const url = await Input.prompt({ message: "Enter URL: " });
    if (action === "list OTPs") {
      PrintEntries(await client.listOTPForURL(url));
    } else if (action === "get OTPs") {
      PrintEntries(await client.getOTPForURL(url));
    }
  })
  .command("get", "Get an OTP for a website.")
  .arguments("<url:string>")
  .action(async (_, url: string) => {
    PrintEntries(await client.getOTPForURL(url));
  })
  .command("list", "List available OTPs for a website.")
  .arguments("<url:string>")
  .action(async (_, url: string) => {
    PrintEntries(await client.listOTPForURL(url));
  });

const pw = new Command()
  .description("Interactively manage accounts/passwords.")
  .action(async () => {
    const action: string = await Select.prompt({
      message: "Choose an action: ",
      options: ["list accounts", "get password", "save account"],
    });
    const url = await Input.prompt({ message: "Enter URL: " });
    if (action === "save account") {
      const username = await Input.prompt({
        message: "Enter username: ",
        minLength: 1,
      });
      const password = await Secret.prompt({
        message: "Enter password: ",
        minLength: 1,
      });
      await client.saveAccountForURL(url, username, password);
      PrintSuccess();
      return;
    }
    if (action === "list accounts") {
      PrintEntries(await client.getLoginNamesForURL(url));
    } else if (action === "get password") {
      PrintEntries(await client.getPasswordForURL(url));
    }
  })
  .command("get", "Get a password for a website.")
  .arguments("<url:string> [username:string]")
  .action(async (_, url: string, username?: string) => {
    PrintEntries(await client.getPasswordForURL(url, username));
  })
  .command("list", "List available accounts for a website.")
  .arguments("<url:string>")
  .action(async (_, url: string) => {
    PrintEntries(await client.getLoginNamesForURL(url));
  })
  .command("save", "Create or update a password.")
  .arguments("<url:string> <username:string>")
  .action(async (_, url: string, username: string) => {
    const password = await Secret.prompt({
      message: "Enter password: ",
      minLength: 1,
    });
    await client.saveAccountForURL(url, username, password);
    PrintSuccess();
  });

const start = new Command()
  .description("Start APW and choose a managed browser.")
  .option("-b, --browser <browser:string>", "Browser to use (auto, chromium, chrome, brave, or edge).")
  .action(async (options: { browser?: string }) => {
    const browsers = installedBrowsers();
    if (!browsers.length) {
      throw new APWError(Status.GENERIC_ERROR, "No supported Chromium browser is installed.");
    }
    const selected = (options.browser ?? await Select.prompt({
      message: "Browser:",
      options: browsers.map(({ name }) => name),
    })).toLowerCase();
    const browser = selected === "auto"
      ? browsers[0]
      : browsers.find(({ id, name }) => id === selected || name.toLowerCase() === selected);
    if (!browser) {
      throw new APWError(Status.INVALID_PARAM, `Unsupported browser: ${selected}`);
    }
    await Daemon(browser);
  });

const auth = new Command()
  .description("Authenticate CLI with daemon.")
  .action(async () => {
    await client.requestChallenge();
    const pin = await Input.prompt({
      message: "Enter PIN: ",
      minLength: 6,
      maxLength: 6,
    });
    await client.verifyChallenge(pin);
    PrintSuccess();
  })
  .command("request", "Request a challenge from the daemon.")
  .action(async () => {
    await client.requestChallenge();
    PrintSuccess();
  })
  .command("response", "Respond to a challenge from the daemon.")
  .option("-p, --pin <pin>", "challenge-response pin.", { required: true })
  .action(async (options: { pin: string }) => {
    await client.verifyChallenge(options.pin);
    PrintSuccess();
  });

try {
  await new Command()
    .name("apw")
    .version(`v${VERSION}`)
    .description("🔑 a CLI for Apple Passwords 🔒")
    .command("auth", auth)
    .command("pw", pw)
    .command("otp", otp)
    .command("start", start)
    .parse(Deno.args);
} catch (error: unknown) {
  let status = Status.GENERIC_ERROR;
  let msg = "Unknown Error";
  if (error instanceof APWError || error instanceof Error) {
    status = error instanceof APWError ? error.status : status;
    msg = error.message;
  }
  console.error(JSON.stringify({ error: msg, status, results: [] }));
  Deno.exit(status);
}
