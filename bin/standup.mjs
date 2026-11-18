#!/usr/bin/env node
// standup — what did I actually do?
import { basename } from "node:path";
import {
  findTranscripts,
  readSession,
  gitLog,
  isRepo,
  gitIdentity,
  dateRange,
  PROJECTS,
} from "../lib/collect.mjs";
import { summarise } from "../lib/summarise.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = "") => {
  const i = argv.indexOf(f);
  return i === -1 ? d : (argv[i + 1] ?? d);
};

// Declared before any top-level code that uses them: `const` after an await
// boundary would otherwise be in its temporal dead zone.
const tty = process.stdout.isTTY && !process.env.NO_COLOR && !has("--md");
const col = (code) => (s) => (tty ? `\u001b[${code}m${s}\u001b[0m` : s);
const bold = col("1");
const dim = col("2");

if (has("--help") || has("-h")) {
  console.log(`standup — what did I actually do?

usage: standup [options]

  standup                     yesterday and today
  standup --days 7            the last week
  standup --since 2026-11-01 --until 2026-11-07
  standup --md > standup.md
  standup --ai                write it as prose with a model

options:
  --days N            days back, including today (default 2)
  --since / --until   explicit range, YYYY-MM-DD
  --project TEXT      only projects whose path contains TEXT
  --md                Markdown instead of terminal output
  --json              machine-readable
  --ai                summarise into prose with claude -p (costs a little)
  --model NAME        model for --ai (default claude-haiku-5-5)
  --no-git            skip commits
  --no-sessions       skip Claude sessions
  --projects DIR      transcripts directory

Reads git commits and your Claude Code sessions. Nothing is sent anywhere
unless you pass --ai.`);
  process.exit(0);
}

const { from, to } = dateRange({
  since: val("--since"),
  until: val("--until"),
  days: val("--days", "2"),
});
const projectFilter = val("--project").toLowerCase();

// --- Claude sessions
const sessions = [];
if (!has("--no-sessions")) {
  for (const f of findTranscripts(val("--projects") || PROJECTS)) {
    let s;
    try {
      s = await readSession(f, { from, to });
    } catch {
      continue;
    }
    if (!s) continue;
    if (projectFilter && !s.cwd.toLowerCase().includes(projectFilter)) continue;
    sessions.push(s);
  }
}
sessions.sort((a, b) => a.first.localeCompare(b.first));

// --- git commits, from the repos those sessions touched
const commits = [];
if (!has("--no-git")) {
  const repos = new Set();
  for (const s of sessions) if (s.cwd && isRepo(s.cwd)) repos.add(s.cwd);
  if (isRepo(process.cwd())) repos.add(process.cwd());
  const author = gitIdentity([...repos][0] || process.cwd());
  for (const r of repos) {
    for (const c of gitLog(r, { from, to, author })) commits.push({ ...c, repo: r });
  }
}
commits.sort((a, b) => a.date.localeCompare(b.date));

const byProject = new Map();
for (const s of sessions) {
  const k = s.cwd || "(unknown)";
  const row = byProject.get(k) || { project: k, sessions: 0, turns: 0, edits: 0, asks: [], commits: [] };
  row.sessions++;
  row.turns += s.turns;
  row.edits += s.edits;
  row.asks.push(...s.asks);
  byProject.set(k, row);
}
for (const c of commits) {
  const row = byProject.get(c.repo) || {
    project: c.repo,
    sessions: 0,
    turns: 0,
    edits: 0,
    asks: [],
    commits: [],
  };
  row.commits.push(c);
  byProject.set(c.repo, row);
}

const projects = [...byProject.values()].sort(
  (a, b) => b.commits.length + b.sessions - (a.commits.length + a.sessions)
);

const range = from === to ? from : `${from} → ${to}`;

if (has("--json")) {
  console.log(JSON.stringify({ range: { from, to }, projects, commits, sessions: sessions.map(stripAsks) }, null, 2));
  process.exit(0);
}

if (!projects.length) {
  console.log(`\nnothing found for ${range}\n`);
  process.exit(0);
}

if (has("--ai")) {
  const text = await summarise({ range, projects, model: val("--model") });
  console.log("\n" + text.trim() + "\n");
  process.exit(0);
}

const md = has("--md");
const out = [];
const h = (s) => out.push(md ? `## ${s}` : `  ${bold(s)}`);

out.push(md ? `# Standup — ${range}` : `\nstandup  ·  ${range}`);

let shown = 0;
for (const p of projects) {
  // A project with no commits and nothing worth quoting is activity, not news.
  const asks = pickAsks(p.asks);
  if (!p.commits.length && !asks.length) continue;
  shown++;
  const name = basename(p.project.replace(/[\\/]+$/, "")) || p.project;
  out.push("");
  h(name);
  if (md) out.push("");

  if (p.commits.length) {
    for (const c of p.commits) {
      const stat = c.files ? ` (${c.files} file${c.files === 1 ? "" : "s"}, +${c.ins}/-${c.del})` : "";
      out.push(md ? `- \`${c.hash}\` ${c.subject}${stat}` : `    ${dim(c.hash)} ${c.subject}${dim(stat)}`);
    }
  }

  if (p.sessions) {
    const bits = [`${p.sessions} session${p.sessions === 1 ? "" : "s"}`];
    if (p.edits) bits.push(`${p.edits} edit${p.edits === 1 ? "" : "s"}`);
    const line = bits.join(", ");
    out.push(md ? `- ${line}` : `    ${dim(line)}`);
    for (const a of asks) {
      out.push(md ? `  - "${a}"` : `      ${dim("·")} ${a}`);
    }
  }
}

const totals = `${commits.length} commit(s), ${sessions.length} session(s), ${shown} project(s)`;
out.push("", md ? `_${totals}_` : `  ${dim(totals)}`, "");
console.log(out.join("\n"));

// ---------- helpers ----------

function stripAsks(s) {
  const { asks, ...rest } = s;
  return rest;
}

/** The asks most likely to describe real work, deduped and trimmed. */
function pickAsks(asks, n = 4) {
  const seen = new Set();
  const out = [];
  for (const a of asks) {
    const t = a.trim();
    if (t.length < 15 || t.length > 220) continue;
    // Skip bare acknowledgements and one-word nudges.
    if (/^(ok|okay|yes|no|yep|sure|thanks|ty|go|do it|continue|try again|next)\b/i.test(t)) continue;
    const key = t.slice(0, 40).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t.length > 140 ? t.slice(0, 137) + "…" : t);
    if (out.length >= n) break;
  }
  return out;
}
