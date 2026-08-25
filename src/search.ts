import { ApplePasswordManager } from "./client.ts";
import * as recall from "./recall.ts";
import type { PasswordEntry, TOTPEntry } from "./types.ts";

/**
 * Registrable suffixes with two parts. Taking the last two labels of
 * mail.foo.co.uk would otherwise yield co.uk, which is a public suffix and not
 * a site. A short list avoids depending on the full public suffix list.
 */
const MULTI_PART_SUFFIXES = new Set(["co.uk", "com.br", "co.jp", "com.au", "co.nz", "com.mx"]);

/** Tried in order when a query carries no dot, e.g. `apw carta`. */
const FALLBACK_TLDS = ["com", "net", "org", "io", "app", "dev"];

export interface ParsedQuery {
  /** True when the query names an account rather than a site. */
  account: boolean;
  /** Hostnames to ask the helper about. Empty means do not ask at all. */
  domains: string[];
  /** When an address was given, restrict results to that account. */
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
  const suffixLength = MULTI_PART_SUFFIXES.has(labels.slice(-2).join(".")) ? 3 : 2;
  if (labels.length > suffixLength) {
    candidates.push(labels.slice(-suffixLength).join("."));
  }

  return [...new Set(candidates)];
}

/**
 * One rule: an `@` anywhere makes the query an account rather than a site.
 *
 * `me@example.com` searches example.com and keeps only that address.
 * `@example.com` asks about every account on that address domain, which the
 * helper cannot answer — it takes hostnames only — so no domains are returned
 * and the caller answers from what it has already recalled.
 *
 * Without this, a leading `@` was stripped as URL userinfo and the account
 * query silently became a site query returning every credential on the domain.
 */
export function parseQuery(query: string): ParsedQuery {
  const trimmed = query.trim();
  if (!trimmed.includes("@") || trimmed.includes("://")) {
    return { account: false, domains: expandDomains(trimmed) };
  }

  const address = trimmed.replace(/^@+/, "");
  const at = address.lastIndexOf("@");
  if (at <= 0) return { account: true, domains: [] };

  return {
    account: true,
    domains: expandDomains(address.slice(at + 1)),
    username: address.toLowerCase(),
  };
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

/**
 * Hostnames previously reached whose leading label starts the query.
 *
 * These beat any ranking: they are the user's own sites, and a private host
 * like grafana.example.com is reachable no other way.
 */
export function recalledHosts(query: string): string[] {
  const q = toHostname(query);
  if (!q || q.includes(".")) return [];
  return recall.hosts().filter((host) => host.split(".")[0].startsWith(q));
}

/** Hostnames worth asking the helper about, best guess first. */
export function candidateHosts(query: string, cap = 8): string[] {
  const { domains } = parseQuery(query);
  if (!domains.length) return [];
  if (toHostname(query).includes(".")) return domains.slice(0, cap);

  // Hosts already seen answer this properly. Everything else is a guess, and
  // the only guess worth making is the obvious one: a ranking of popular
  // domains cannot know a private hostname, and cost 136 KB to be wrong about
  // the rest. A site not seen before is found by searching it once in full.
  const guesses = domains.filter((host) => host.includes("."));
  return [...new Set([...recalledHosts(query), ...guesses])].slice(0, cap);
}

/** A bare IPv4 literal is a LAN address, not a registrable domain. */
const isIpLiteral = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

/**
 * Apple stores a credential against a registrable domain but a one-time code
 * against the host, so `openai.com` returns a password for auth.openai.com and
 * a code for openai.com. Merging on the host loses the pairing; merging on the
 * registrable domain — which Apple already supplies as highLevelDomain —
 * keeps it without needing the public suffix list, and still keeps live.com
 * and microsoftonline.com apart.
 */
function mergeKey(entry: PasswordEntry | TOTPEntry): string {
  const domain = domainOf(entry).toLowerCase();
  const registrable = isPassword(entry) ? (entry.highLevelDomain ?? domain) : domain;
  const base = !registrable || isIpLiteral(registrable) ? domain : registrable.toLowerCase();
  return `${base}\n${usernameOf(entry).toLowerCase()}`;
}

/** Entries, plus which of them Apple also holds a one-time code for. */
export interface SearchResult {
  entries: Array<PasswordEntry | TOTPEntry>;
  /** mergeKey values that have a code; ask with hasCode(result, entry). */
  coded: Set<string>;
}

/** Whether this account also has a one-time code, per the merge rule above. */
export function hasCode(result: SearchResult, entry: PasswordEntry | TOTPEntry): boolean {
  return result.coded.has(mergeKey(entry));
}

export async function fuzzySearch(client: ApplePasswordManager, query: string): Promise<SearchResult> {
  const { username } = parseQuery(query);
  const hosts = candidateHosts(query);
  if (!hosts.length) return { entries: [], coded: new Set() };

  const seen = new Set<string>();
  const entries: Array<PasswordEntry | TOTPEntry> = [];
  const withCode = new Set<string>();

  for (const [index, host] of hosts.entries()) {
    // The first host is what the user asked for, so its failure is reported.
    // Later hosts are guesses, and a miss on a guess is not news.
    const speculative = index > 0;

    const otps = await client.listOTPForURL(host).catch(() => null);
    for (const entry of otps?.Entries ?? []) {
      if (!isPassword(entry)) withCode.add(mergeKey(entry));
    }

    const logins = speculative
      ? await client.getLoginNamesForURL(host).catch(() => null)
      : await client.getLoginNamesForURL(host);

    for (const entry of logins?.Entries ?? []) {
      if (username && !matchesUsername(entry, username)) continue;
      const key = keyOf(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }

  recall.record(entries.flatMap((entry) => recall.hostsOf(entry)));
  return { entries, coded: withCode };
}

/**
 * The helper only answers hostname-scoped queries and exposes no action that
 * enumerates the vault, so an address can only be looked up against its own
 * mail domain. Say that, rather than letting an empty result read as "no such
 * account".
 */
export function emailScopeHint(query: string, resultCount: number): string | undefined {
  if (resultCount > 0) return undefined;
  const { account, domains, username } = parseQuery(query);
  if (!account) return undefined;

  if (!username || !domains.length) {
    return "Apple's helper only answers per-site queries, so every account on an address " +
      "domain cannot be listed. Search a site instead, or use a client that remembers " +
      "the accounts it has already seen.";
  }

  return `No account stored at ${domains[0]} for this address. Apple's helper only answers ` +
    `per-site queries, so an email cannot be searched across the whole vault. ` +
    `Search the site itself instead: apw find ${domains[0]}`;
}
