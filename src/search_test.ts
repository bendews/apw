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

Deno.test("an email query searches its domain and filters by address", () => {
  assertEquals(parseQuery("me@foo.com"), {
    domains: ["foo.com"],
    username: "me@foo.com",
  });
});

Deno.test("an email on a bare domain still expands TLDs", () => {
  const parsed = parseQuery("me@carta");
  assertEquals(parsed.username, "me@carta");
  assertEquals(parsed.domains[0], "carta");
  assertEquals(parsed.domains.includes("carta.com"), true);
});

Deno.test("a URL is not mistaken for an email", () => {
  assertEquals(parseQuery("https://foo.com/a").username, undefined);
});

Deno.test("a site query carries no username filter", () => {
  assertEquals(parseQuery("github.com"), { domains: ["github.com"] });
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

import { listWithFallback } from "./search.ts";
import type { ApplePasswordManager } from "./client.ts";
import type { Payload } from "./types.ts";

/** Records every hostname asked for, answering only from `vault`. */
function stubClient(vault: Record<string, string[]>) {
  const asked: string[] = [];
  const reply = (url: string): Promise<Payload> => {
    asked.push(url);
    const users = vault[url] ?? [];
    return Promise.resolve({
      STATUS: 0,
      Entries: users.map((USR) => ({ USR, sites: [url] })),
    } as Payload);
  };
  const client = {
    getLoginNamesForURL: reply,
    listOTPForURL: reply,
  } as unknown as ApplePasswordManager;
  return { client, asked };
}

Deno.test("an exact hit is returned without widening the search", async () => {
  const { client, asked } = stubClient({ "github.com": ["me"] });
  const payload = await listWithFallback(client, "github.com", "pw");
  assertEquals(payload.Entries.length, 1);
  assertEquals(asked, ["github.com"]);
});

Deno.test("a miss widens to the expanded candidates", async () => {
  const { client, asked } = stubClient({ "github.com": ["me"] });
  const payload = await listWithFallback(client, "github", "pw");
  assertEquals(payload.Entries.length, 1);
  assertEquals(asked[0], "github");
  assertEquals(asked.includes("github.com"), true);
});

Deno.test("--no-fuzzy keeps the old exact-only behaviour", async () => {
  const { client, asked } = stubClient({ "github.com": ["me"] });
  const payload = await listWithFallback(client, "github", "pw", false);
  assertEquals(payload.Entries.length, 0);
  assertEquals(asked, ["github"]);
});

Deno.test("entries repeated across candidates appear once", async () => {
  const { client } = stubClient({ "foo.com": ["me"] });
  const payload = await listWithFallback(client, "www.foo.com", "pw");
  assertEquals(payload.Entries.length, 1);
});

Deno.test("an error on the exact query propagates instead of becoming empty", async () => {
  const client = {
    getLoginNamesForURL: () => Promise.reject(Object.assign(new Error("unpaired"), { status: 9 })),
    listOTPForURL: () => Promise.reject(new Error("unpaired")),
  } as unknown as ApplePasswordManager;

  let caught: unknown;
  try {
    await listWithFallback(client, "github.com", "pw");
  } catch (error) {
    caught = error;
  }
  assertEquals((caught as { status?: number })?.status, 9);
});

Deno.test("a failing guess does not sink the whole search", async () => {
  let call = 0;
  const client = {
    getLoginNamesForURL: (url: string) => {
      call++;
      if (call === 1) return Promise.resolve({ STATUS: 0, Entries: [] } as Payload);
      if (url === "github.com") {
        return Promise.resolve({ STATUS: 0, Entries: [{ USR: "me", sites: [url] }] } as Payload);
      }
      return Promise.reject(new Error("boom"));
    },
    listOTPForURL: () => Promise.resolve({ STATUS: 0, Entries: [] } as Payload),
  } as unknown as ApplePasswordManager;

  const payload = await listWithFallback(client, "github", "pw");
  assertEquals(payload.Entries.length, 1);
});
