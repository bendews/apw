import type { PasswordEntry, TOTPEntry } from "./types.ts";

/**
 * Resolved when used rather than at import, so the file follows HOME. A path
 * frozen at import cannot be pointed anywhere else, which makes the read and
 * write paths untestable without touching the user's real index.
 */
const indexPath = () => `${Deno.env.get("HOME")}/.apw/index.json`;

/** Enough to cover a heavy user's whole vault; a guard, not a budget. */
const MAX_HOSTS = 2000;
const PRUNE_AFTER_DAYS = 180;

interface Index {
  version: 1;
  /** hostname -> ISO date it was last seen */
  hosts: Record<string, string>;
}

const today = () => new Date().toISOString().slice(0, 10);

/** A bare IPv4 literal is a LAN address, not something worth recalling. */
const isIpLiteral = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

/**
 * Hostnames worth remembering from a result row.
 *
 * Hosts carrying a port or a path are not shorthand targets, and a LAN address
 * describes the user's internal network rather than a site.
 */
export function hostsOf(entry: PasswordEntry | TOTPEntry): string[] {
  const sites: string[] = "USR" in entry ? (entry.sites ?? []) : [entry.domain];
  return (sites ?? [])
    .map((site) => (site ?? "").trim().toLowerCase())
    .filter((host) => host && !host.includes(":") && !host.includes("/") && !isIpLiteral(host));
}

export function isEnabled(): boolean {
  try {
    const config = JSON.parse(
      Deno.readTextFileSync(indexPath().replace(/index\.json$/, "config.json")),
    );
    return config?.recall !== false;
  } catch {
    return true;
  }
}

export function read(): Index {
  try {
    const parsed = JSON.parse(Deno.readTextFileSync(indexPath())) as Index;
    if (parsed?.version === 1 && parsed.hosts && typeof parsed.hosts === "object") {
      // Shape is not enough: a hand-edited value that is not a date would throw
      // out of hosts(), which the comment below promises cannot happen.
      const hosts = Object.fromEntries(
        Object.entries(parsed.hosts).filter(([, at]) => typeof at === "string"),
      );
      return { version: 1, hosts };
    }
  } catch {
    // Missing, unreadable or corrupt. Recall is an optimisation, never a
    // prerequisite, so start over rather than failing the search.
  }
  return { version: 1, hosts: {} };
}

/** Hostnames previously seen, most recently seen first. */
export function hosts(): string[] {
  const { hosts } = read();
  return Object.entries(hosts)
    .sort((a, b) => b[1].localeCompare(a[1]) || a[0].localeCompare(b[0]))
    .map(([host]) => host);
}

function write(index: Index): void {
  // Per-pid temporary name: debounced searches from a front end overlap, and a
  // shared name lets one writer truncate another's file before rename
  // publishes the wreckage.
  const path = indexPath();
  const tmp = `${path}.${Deno.pid}.tmp`;
  try {
    Deno.mkdirSync(path.replace(/\/[^/]+$/, ""), { recursive: true, mode: 0o700 });
    Deno.writeTextFileSync(tmp, JSON.stringify(index), { mode: 0o600 });
    Deno.renameSync(tmp, path);
  } catch {
    try {
      Deno.removeSync(tmp);
    } catch { /* nothing to clean up */ }
  }
}

/**
 * Remember hostnames a lookup actually reached. Read-merge-write from disk each
 * time, so a concurrent forget loses only the run in flight rather than being
 * overwritten wholesale by a stale in-memory copy.
 */
export function record(seen: string[]): void {
  if (!seen.length || !isEnabled()) return;

  const index = read();
  const stamp = today();
  for (const host of seen) index.hosts[host] = stamp;

  const cutoff = new Date(Date.now() - PRUNE_AFTER_DAYS * 86_400_000).toISOString().slice(0, 10);
  const kept = Object.entries(index.hosts)
    .filter(([, at]) => at >= cutoff)
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, MAX_HOSTS);

  write({ version: 1, hosts: Object.fromEntries(kept) });
}

/** Drop hosts containing `query`, or the whole index when none is given. */
export function forget(query?: string): number {
  const index = read();
  const before = Object.keys(index.hosts).length;

  if (!query) {
    try {
      Deno.removeSync(indexPath());
    } catch { /* already gone */ }
    return before;
  }

  const q = query.trim().toLowerCase();
  // An empty query would match every host, which is what forget() with no
  // argument means — not what someone typing whitespace meant.
  if (!q) return 0;
  const kept = Object.entries(index.hosts).filter(([host]) => !host.includes(q));
  write({ version: 1, hosts: Object.fromEntries(kept) });
  return before - kept.length;
}
