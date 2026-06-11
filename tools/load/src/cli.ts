import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Flag + env parsing for the load harness. Everything has a localhost-friendly default so
 * `pnpm load` works out of the box against a locally running stack. DATABASE_URL (for the
 * read-only post-run assertions) and CHANNEL_STUB_URL are read from apps/crm-api/.env when
 * not already in the environment, so the harness uses the SAME database the API writes to.
 */
export interface LoadOptions {
  /** Target number of communications to push (audience is sized to meet/exceed this). */
  count: number;
  /** Base URL of the locally running crm-api (the only service the harness calls). */
  crmUrl: string;
  /** Base URL of the channel-stub — used only for a preflight /health check. */
  stubUrl: string;
  /** Postgres connection string for the read-only assertion queries. */
  databaseUrl: string;
  /** Channel to send on. EMAIL reaches every seeded customer (all have an email). */
  channel: "EMAIL" | "SMS" | "WHATSAPP" | "RCS";
  /** Per-request HTTP timeout (ms). */
  httpTimeoutMs: number;
  /** Poll cadence while draining (ms). */
  pollMs: number;
  /** Overall ceiling from launch to fully-drained (ms) before giving up. */
  drainTimeoutMs: number;
  /**
   * Quiescence window (ms): once the campaign is COMPLETED and no new CommunicationEvent has
   * landed for this long, the loop is considered fully drained. MUST exceed the stub's
   * MAX_DELAY_MS (default 30_000) so late engagement/duplicate callbacks are not raced.
   */
  quietMs: number;
}

const CHANNELS = ["EMAIL", "SMS", "WHATSAPP", "RCS"] as const;

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(arg.slice(2), next);
        i++;
      } else {
        flags.set(arg.slice(2), "true");
      }
    }
  }
  return flags;
}

/** Minimal read-only .env parser (no dependency). Returns {} if the file is absent. */
function readDotEnv(path: string): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function num(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ${label}: "${value}" (expected a positive number)`);
  }
  return n;
}

export function parseOptions(argv: string[]): LoadOptions {
  const flags = parseFlags(argv);

  // crm-api/.env supplies DATABASE_URL + CHANNEL_STUB_URL when the shell hasn't already.
  const crmEnvPath = resolve(__dirname, "../../../apps/crm-api/.env");
  const fileEnv = readDotEnv(crmEnvPath);
  const env = (key: string): string | undefined => process.env[key] ?? fileEnv[key];

  const count = Math.floor(
    num(flags.get("count") ?? env("LOAD_COUNT"), 500, "--count"),
  );

  const channelRaw = (flags.get("channel") ?? env("LOAD_CHANNEL") ?? "EMAIL").toUpperCase();
  if (!CHANNELS.includes(channelRaw as (typeof CHANNELS)[number])) {
    throw new Error(`Invalid --channel "${channelRaw}" (one of ${CHANNELS.join(", ")})`);
  }

  const databaseUrl = flags.get("database-url") ?? env("DATABASE_URL");
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for the read-only assertions. Set it in the environment, " +
        "pass --database-url=..., or ensure apps/crm-api/.env defines it.",
    );
  }

  const crmUrl = (flags.get("crm-url") ?? env("CRM_URL") ?? "http://localhost:3001").replace(
    /\/$/,
    "",
  );
  const stubUrl = (
    flags.get("stub-url") ??
    env("STUB_URL") ??
    env("CHANNEL_STUB_URL") ??
    "http://localhost:3002"
  ).replace(/\/$/, "");

  return {
    count,
    crmUrl,
    stubUrl,
    databaseUrl,
    channel: channelRaw as LoadOptions["channel"],
    httpTimeoutMs: Math.floor(num(flags.get("timeout"), 20_000, "--timeout")),
    pollMs: Math.floor(num(flags.get("poll-ms"), 2_000, "--poll-ms")),
    drainTimeoutMs: Math.floor(
      num(flags.get("drain-timeout"), 1_200_000, "--drain-timeout"),
    ),
    quietMs: Math.floor(num(flags.get("quiet-ms"), 35_000, "--quiet-ms")),
  };
}
