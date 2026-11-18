// Gather what you actually did: git commits plus Claude Code sessions.
import { homedir } from "node:os";
import { join } from "node:path";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { execFileSync } from "node:child_process";

export const PROJECTS = process.env.STANDUP_PROJECTS || join(homedir(), ".claude", "projects");

/** Machine-written transcripts, not conversations you had. */
const BOT = [/observer-sessions/i, /claude-mem/i];

export function findTranscripts(root = PROJECTS) {
  const out = [];
  if (!existsSync(root)) return out;
  for (const dir of readdirSync(root)) {
    if (BOT.some((re) => re.test(dir))) continue;
    const d = join(root, dir);
    try {
      if (!statSync(d).isDirectory()) continue;
      for (const f of readdirSync(d)) {
        if (!f.endsWith(".jsonl")) continue;
        const p = join(d, f);
        if (statSync(p).isFile()) out.push(p);
      }
    } catch {
      /* unreadable directory */
    }
  }
  return out;
}

const NOISE = ["<system-reminder>", "<command-name>", "Caveat:"];

/**
 * Harness-injected messages arrive with role "user" but were never typed by
 * anyone. They are bracketed notices, pasted blocks and tool plumbing — and
 * they read as absurd standup items if they get through.
 */
const NOT_A_HUMAN_ASK = [
  /^\[/, // [Request interrupted], [Earlier usage-limit notes…]
  /^<\w/, // <pasted_content>, <system-reminder>
  /^#\s*(claude-mem|Environment|tinymem)\b/i,
  /no longer apply/i,
  /^Base directory for this skill/i,
  /^Launching skill:/i,
];

function isHumanAsk(t) {
  return !NOT_A_HUMAN_ASK.some((re) => re.test(t));
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

/**
 * Read one transcript, keeping only what a standup needs: which project, when,
 * and the user's own asks. Streamed, because transcripts reach hundreds of MB.
 */
export async function readSession(file, { from, to }) {
  let rl;
  try {
    rl = createInterface({
      input: createReadStream(file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
  } catch {
    return null;
  }

  const cwdCount = new Map();
  const asks = [];
  const tools = new Map();
  let session = "";
  let first = "";
  let last = "";
  let turns = 0;
  let edits = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.sessionId && !session) session = e.sessionId;
    if (e.cwd) cwdCount.set(e.cwd, (cwdCount.get(e.cwd) || 0) + 1);
    if (e.isSidechain) continue;

    const ts = e.timestamp || "";
    if (ts) {
      const day = ts.slice(0, 10);
      if (from && day < from) continue;
      if (to && day > to) continue;
      if (!first) first = ts;
      last = ts;
    }

    if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      for (const b of e.message.content) {
        if (b && b.type === "tool_use") {
          tools.set(b.name, (tools.get(b.name) || 0) + 1);
          if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(b.name)) edits++;
        }
      }
    }

    if (e.type !== "user" && e.type !== "assistant") continue;
    const role = e.message?.role;
    if (!role) continue;
    const text = textOf(e.message.content).trim();
    if (!text || NOISE.some((n) => text.startsWith(n))) continue;
    turns++;
    // Only the user's own words: what you asked for is the story of the day.
    if (role === "user" && text.length > 8 && asks.length < 40 && isHumanAsk(text)) {
      asks.push(text.replace(/\s+/g, " ").slice(0, 400));
    }
  }
  rl.close();

  if (!first || turns < 2) return null;

  let cwd = "";
  let best = -1;
  for (const [k, v] of cwdCount) if (v > best) ((best = v), (cwd = k));

  return { file, session, cwd, first, last, turns, edits, asks, tools: [...tools.entries()] };
}

/** Commits by this author in the range, across the given repos. */
export function gitLog(repo, { from, to, author }) {
  const args = [
    "-C",
    repo,
    "log",
    "--no-merges",
    `--since=${from}T00:00:00`,
    `--until=${to}T23:59:59`,
    "--pretty=format:%H\u0001%ad\u0001%s\u0001%an",
    "--date=short",
    "--shortstat",
  ];
  if (author) args.push(`--author=${author}`);
  let out;
  try {
    out = execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return [];
  }
  const commits = [];
  let current = null;
  for (const line of out.split("\n")) {
    if (line.includes("\u0001")) {
      const [hash, date, subject, an] = line.split("\u0001");
      current = { hash: hash.slice(0, 7), date, subject, author: an, files: 0, ins: 0, del: 0 };
      commits.push(current);
    } else if (current && line.trim()) {
      const f = line.match(/(\d+) files? changed/);
      const i = line.match(/(\d+) insertions?/);
      const d = line.match(/(\d+) deletions?/);
      if (f) current.files = +f[1];
      if (i) current.ins = +i[1];
      if (d) current.del = +d[1];
    }
  }
  return commits;
}

export function isRepo(dir) {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

export function gitIdentity(dir) {
  try {
    return execFileSync("git", ["-C", dir, "config", "user.email"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** Dates to cover, inclusive. */
export function dateRange({ since, until, days }) {
  const end = until ? new Date(until + "T00:00:00Z") : new Date();
  let start;
  if (since) start = new Date(since + "T00:00:00Z");
  else {
    start = new Date(end);
    // Default 2 — yesterday and today, which is what a standup covers.
    // Must match the CLI's documented default.
    start.setUTCDate(start.getUTCDate() - (Number(days) || 2) + 1);
  }
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end) };
}
