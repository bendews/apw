import { assertEquals } from "@std/assert";
import { hostsOf } from "./recall.ts";
import type { PasswordEntry, TOTPEntry } from "./types.ts";

const password = (sites: string[]): PasswordEntry => ({ USR: "me", sites });
const totp = (domain: string): TOTPEntry => ({ username: "me", domain, source: "totp" });

Deno.test("every site on a password entry is worth remembering", () => {
  assertEquals(hostsOf(password(["a.example.com", "b.example.com"])), [
    "a.example.com",
    "b.example.com",
  ]);
});

Deno.test("a host carrying a port is not a shorthand target", () => {
  assertEquals(hostsOf(password(["wiki.example.com:9443", "wiki.example.com"])), [
    "wiki.example.com",
  ]);
});

Deno.test("a LAN address describes a network, not a site", () => {
  assertEquals(hostsOf(password(["192.168.1.51", "nas.example.com"])), ["nas.example.com"]);
});

Deno.test("an entry with no sites contributes nothing", () => {
  assertEquals(hostsOf(password([])), []);
});

Deno.test("a one-time-code entry contributes its domain", () => {
  assertEquals(hostsOf(totp("example.com")), ["example.com"]);
});
