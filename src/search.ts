import { ApplePasswordManager } from "./client.ts";
import type { PasswordEntry, Payload, TOTPEntry } from "./types.ts";
import { Status } from "./const.ts";

/** Tried in order when a query carries no dot, e.g. `apw carta`. */
const FALLBACK_TLDS = ["com", "net", "org", "io", "app", "dev"];

export interface ParsedQuery {
  /** Hostnames to ask the helper about, most specific first. */
  domains: string[];
  /** When the query was an email, restrict results to that account. */
  username?: string;
}

/** Reduce anything URL-ish (`https://a.b.com/x?y`) to a bare hostname. */
export function toHostname(input: string): string {
  let host = input.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  host = host.split(/[/?#]/, 1)[0];
  host = host.replace(/^[^@]*@/, "").replace(/:\d+$/, "");
  return host.toLowerCase();
}

/**
 * Expand a hostname into the candidates worth querying. A bare word gains the
 * common TLDs; a subdomain also yields its registrable base, so `mail.foo.com`
 * still finds a credential stored against `foo.com`.
 */
export function expandDomains(input: string): string[] {
  const host = toHostname(input);
  if (!host) return [];

  const candidates = [host];
  if (!host.includes(".")) {
    candidates.push(...FALLBACK_TLDS.map((tld) => `${host}.${tld}`));
  }

  const labels = host.split(".").filter(Boolean);
  if (labels.length > 2) {
    candidates.push(labels.slice(-2).join("."));
  }

  return [...new Set(candidates)];
}

/**
 * An `@` makes the query an account rather than a site: search the mail domain
 * but keep only entries belonging to that address.
 */
export function parseQuery(query: string): ParsedQuery {
  const trimmed = query.trim();
  const at = trimmed.lastIndexOf("@");
  if (at > 0 && at < trimmed.length - 1 && !trimmed.includes("://")) {
    return {
      domains: expandDomains(trimmed.slice(at + 1)),
      username: trimmed.toLowerCase(),
    };
  }
  return { domains: expandDomains(trimmed) };
}

const isPassword = (entry: PasswordEntry | TOTPEntry): entry is PasswordEntry => "USR" in entry;

const usernameOf = (entry: PasswordEntry | TOTPEntry): string => isPassword(entry) ? entry.USR : entry.username;

const domainOf = (entry: PasswordEntry | TOTPEntry): string =>
  isPassword(entry) ? (entry.sites?.[0] ?? "") : entry.domain;

const keyOf = (entry: PasswordEntry | TOTPEntry): string =>
  `${isPassword(entry) ? "pw" : "otp"}:${domainOf(entry).toLowerCase()}:${usernameOf(entry).toLowerCase()}`;

/** Match the whole address, or the local part when the entry stores only that. */
function matchesUsername(entry: PasswordEntry | TOTPEntry, wanted: string): boolean {
  const actual = usernameOf(entry).toLowerCase();
  if (actual === wanted) return true;
  const local = wanted.slice(0, wanted.lastIndexOf("@"));
  return actual === local;
}

export interface SearchOptions {
  /** Include one-time codes alongside passwords. */
  otp?: boolean;
  /** Keep only accounts whose username contains this, case-insensitively. */
  user?: string;
}

/**
 * Query every candidate domain, merge password and OTP hits, and drop
 * duplicates. A domain that returns nothing is not an error: with TLD guessing
 * most candidates are expected to miss.
 */
export async function fuzzySearch(
  client: ApplePasswordManager,
  query: string,
  options: SearchOptions = {},
): Promise<Payload> {
  const { domains, username } = parseQuery(query);
  const substring = options.user?.trim().toLowerCase();
  const seen = new Set<string>();
  const entries: Array<PasswordEntry | TOTPEntry> = [];
  const otpAccounts = new Set<string>();

  for (const [index, domain] of domains.entries()) {
    const found: Array<PasswordEntry | TOTPEntry> = [];
    // The first domain is what the user actually asked for, so its failure is
    // reported. Later domains are guesses, and a miss on a guess is not news.
    const speculative = index > 0;

    if (options.otp !== false) {
      const otps = await client.listOTPForURL(domain).catch(() => null);
      for (const entry of otps?.Entries ?? []) {
        if (!isPassword(entry)) otpAccounts.add(usernameOf(entry).toLowerCase());
        found.push(entry);
      }
    }

    const logins = speculative
      ? await client.getLoginNamesForURL(domain).catch(() => null)
      : await client.getLoginNamesForURL(domain);
    found.push(...(logins?.Entries ?? []));

    for (const entry of found) {
      if (username && !matchesUsername(entry, username)) continue;
      if (substring && !usernameOf(entry).toLowerCase().includes(substring)) continue;
      const key = keyOf(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }

  return { STATUS: Status.SUCCESS, Entries: entries };
}

/** Accounts that also hold a one-time code, for annotating password rows. */
export function otpUsernames(payload: Payload): Set<string> {
  const names = new Set<string>();
  for (const entry of payload.Entries) {
    if (!isPassword(entry)) names.add(entry.username.toLowerCase());
  }
  return names;
}

/**
 * The helper only answers hostname-scoped queries — there is no action that
 * enumerates the vault — so an email can only be looked up against its own mail
 * domain. Say so instead of letting an empty result read as "no such account".
 */
export function emailScopeHint(query: string, resultCount: number): string | undefined {
  if (resultCount > 0) return undefined;
  const { domains, username } = parseQuery(query);
  if (!username) return undefined;
  return `No account stored at ${domains[0]} for this address. Apple's helper only answers ` +
    `per-site queries, so an email cannot be searched across the whole vault. ` +
    `Search the site instead, then narrow it: apw find <site> --user ${username}`;
}

/**
 * Exact-first lookup with a widening fallback. The exact query is issued
 * unchanged, so a call that already returns entries behaves identically; only a
 * lookup that would have come back empty is retried against the expanded
 * candidates. That keeps every existing wrapper (Raycast, LaunchBar, scripts)
 * working while giving them shorthand queries for free.
 */
export async function listWithFallback(
  client: ApplePasswordManager,
  query: string,
  kind: "pw" | "otp",
  fuzzy = true,
): Promise<Payload> {
  const fetch = (host: string) => kind === "pw" ? client.getLoginNamesForURL(host) : client.listOTPForURL(host);

  // Deliberately not caught: an error here (an unpaired session, say) is real
  // and callers dispatch on its status. Only the speculative widening below
  // tolerates failures.
  const exact = await fetch(query);
  if (!fuzzy || exact.Entries.length > 0) return exact;

  const seen = new Set<string>();
  const entries: Array<PasswordEntry | TOTPEntry> = [];
  for (const candidate of expandDomains(query)) {
    if (candidate === query) continue;
    const payload = await fetch(candidate).catch(() => null);
    for (const entry of payload?.Entries ?? []) {
      const key = keyOf(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }

  return { STATUS: Status.SUCCESS, Entries: entries };
}
