import { assertEquals } from "@std/assert";
import { emailScopeHint, expandDomains, parseQuery, toHostname } from "./search.ts";

Deno.test("toHostname strips scheme, path, port and credentials", () => {
  assertEquals(toHostname("https://mail.foo.com:8443/inbox?x=1"), "mail.foo.com");
  assertEquals(toHostname("user@foo.com"), "foo.com");
  assertEquals(toHostname("  FOO.com/  "), "foo.com");
});

Deno.test("a bare word gains the common TLDs", () => {
  assertEquals(expandDomains("carta"), [
    "carta",
    "carta.com",
    "carta.net",
    "carta.org",
    "carta.io",
    "carta.app",
    "carta.dev",
  ]);
});

Deno.test("a subdomain also yields its registrable base", () => {
  assertEquals(expandDomains("mail.google.com"), ["mail.google.com", "google.com"]);
});

Deno.test("a plain domain is left alone", () => {
  assertEquals(expandDomains("github.com"), ["github.com"]);
});

Deno.test("candidates are deduplicated", () => {
  assertEquals(expandDomains("a.b"), ["a.b"]);
  assertEquals(new Set(expandDomains("x.y.z")).size, expandDomains("x.y.z").length);
});

Deno.test("an empty query yields no candidates", () => {
  assertEquals(expandDomains("   "), []);
});

Deno.test("an address searches its mail domain and filters to that account", () => {
  assertEquals(parseQuery("me@foo.com"), {
    account: true,
    domains: ["foo.com"],
    username: "me@foo.com",
  });
});

Deno.test("a leading @ asks about the address domain, which the helper cannot answer", () => {
  assertEquals(parseQuery("@foo.com"), { account: true, domains: [] });
});

Deno.test("a bare @ is not an account query worth sending anywhere", () => {
  assertEquals(parseQuery("@"), { account: true, domains: [] });
});

Deno.test("a two-part suffix is not mistaken for a registrable domain", () => {
  const expanded = expandDomains("mail.foo.co.uk");
  assertEquals(expanded.includes("co.uk"), false);
  assertEquals(expanded.includes("foo.co.uk"), true);
});

Deno.test("an address on a bare domain still expands TLDs", () => {
  const parsed = parseQuery("me@carta");
  assertEquals(parsed.username, "me@carta");
  assertEquals(parsed.domains[0], "carta");
  assertEquals(parsed.domains.includes("carta.com"), true);
});

Deno.test("a URL is not mistaken for an email", () => {
  assertEquals(parseQuery("https://foo.com/a").username, undefined);
});

Deno.test("a site query carries no username filter", () => {
  assertEquals(parseQuery("github.com"), { account: false, domains: ["github.com"] });
});

Deno.test("an email that found nothing explains the per-site limitation", () => {
  const hint = emailScopeHint("me@foo.com", 0);
  assertEquals(hint?.includes("cannot be searched across the whole vault"), true);
  assertEquals(hint?.includes("foo.com"), true);
});

Deno.test("no hint when the email search found something", () => {
  assertEquals(emailScopeHint("me@foo.com", 2), undefined);
});

Deno.test("no hint for a plain site query", () => {
  assertEquals(emailScopeHint("github.com", 0), undefined);
});

Deno.test("a leading @ explains why the vault cannot be listed", () => {
  const hint = emailScopeHint("@foo.com", 0);
  assertEquals(hint?.includes("cannot be listed"), true);
});

import type { ApplePasswordManager } from "./client.ts";
import type { PasswordEntry, Payload, TOTPEntry } from "./types.ts";
import { candidateHosts, fuzzySearch, hasCode } from "./search.ts";

/**
 * `find` records what it reaches, so every case that drives it points HOME at a
 * throwaway directory first. Without this the suite writes its fixtures into
 * the developer's own index — and reads from it, making two assertions depend
 * on whatever that machine happens to have seen.
 */
async function inTempHome<T>(body: () => Promise<T> | T): Promise<T> {
  const previous = Deno.env.get("HOME") ?? "";
  Deno.env.set("HOME", Deno.makeTempDirSync({ prefix: "apw-search-" }));
  try {
    return await body();
  } finally {
    Deno.env.set("HOME", previous);
  }
}

/** Answers only from `vault`, and records every hostname it was asked about. */
function stub(
  vault: Record<string, Array<Partial<PasswordEntry>>>,
  otps: Record<string, Array<Partial<TOTPEntry>>> = {},
) {
  const asked: string[] = [];
  const client = {
    getLoginNamesForURL: (url: string) => {
      asked.push(url);
      return Promise.resolve({
        STATUS: 0,
        Entries: (vault[url] ?? []).map((e) => ({ USR: "me", sites: [url], ...e })),
      } as Payload);
    },
    listOTPForURL: (url: string) =>
      Promise.resolve({
        STATUS: 0,
        Entries: (otps[url] ?? []).map((e) => ({ username: "me", domain: url, source: "totp", ...e })),
      } as Payload),
  } as unknown as ApplePasswordManager;
  return { client, asked };
}

Deno.test("a one-time code stored on the registrable domain still pairs with its account", async () => {
  await inTempHome(async () => {
    // Apple returns the password against auth.example.com and the code against
    // example.com. Matching on the host loses the pairing.
    const { client } = stub(
      { "example.com": [{ USR: "me", sites: ["auth.example.com"], highLevelDomain: "example.com" }] },
      { "example.com": [{ username: "me", domain: "example.com" }] },
    );
    const result = await fuzzySearch(client, "example.com");
    assertEquals(result.entries.length, 1);
    assertEquals(hasCode(result, result.entries[0]), true);
  });
});

Deno.test("two brands sharing a query do not merge into one another", async () => {
  await inTempHome(async () => {
    const { client } = stub({
      "example.com": [
        { USR: "me", sites: ["login.a.com"], highLevelDomain: "a.com" },
        { USR: "me", sites: ["login.b.com"], highLevelDomain: "b.com" },
      ],
    }, { "example.com": [{ username: "me", domain: "a.com" }] });
    const result = await fuzzySearch(client, "example.com");
    assertEquals(result.entries.length, 2);
    const coded = result.entries.map((e) => hasCode(result, e));
    assertEquals(coded.filter(Boolean).length, 1);
  });
});

Deno.test("an address keeps only that account", async () => {
  await inTempHome(async () => {
    const { client } = stub({
      "example.com": [{ USR: "me@example.com" }, { USR: "someone@example.com" }],
    });
    const result = await fuzzySearch(client, "me@example.com");
    assertEquals(result.entries.map((e) => (e as PasswordEntry).USR), ["me@example.com"]);
  });
});

Deno.test("a leading @ never reaches the helper", async () => {
  await inTempHome(async () => {
    const { client, asked } = stub({ "example.com": [{ USR: "me" }] });
    const result = await fuzzySearch(client, "@example.com");
    assertEquals(result.entries, []);
    assertEquals(asked, []);
  });
});

Deno.test("a failure on the host actually asked for is reported, not swallowed", async () => {
  await inTempHome(async () => {
    const client = {
      getLoginNamesForURL: () => Promise.reject(Object.assign(new Error("unpaired"), { status: 9 })),
      listOTPForURL: () => Promise.reject(new Error("unpaired")),
    } as unknown as ApplePasswordManager;

    let caught: { status?: number } | undefined;
    await fuzzySearch(client, "example.com").catch((e) => (caught = e));
    assertEquals(caught?.status, 9);
  });
});

Deno.test("a guess that fails does not sink the search", async () => {
  await inTempHome(async () => {
    let call = 0;
    const client = {
      getLoginNamesForURL: (url: string) => {
        if (++call > 1 && url !== "carta.com") return Promise.reject(new Error("boom"));
        return Promise.resolve({
          STATUS: 0,
          Entries: url === "carta.com" ? [{ USR: "me", sites: [url] }] : [],
        } as Payload);
      },
      listOTPForURL: () => Promise.resolve({ STATUS: 0, Entries: [] } as Payload),
    } as unknown as ApplePasswordManager;
    const result = await fuzzySearch(client, "carta");
    assertEquals(result.entries.length, 1);
  });
});

Deno.test("a query that is already a hostname is asked for verbatim, and only it", async () => {
  await inTempHome(async () => {
    assertEquals(candidateHosts("auth.example.com")[0], "auth.example.com");
  });
});

Deno.test("candidates are bounded so one search cannot fan out without limit", async () => {
  await inTempHome(async () => {
    assertEquals(candidateHosts("carta").length <= 8, true);
  });
});
