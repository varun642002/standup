#!/usr/bin/env node
// Dependency-free tests. Run: node test/smoke.mjs
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findTranscripts, readSession, dateRange, gitLog, isRepo } from "../lib/collect.mjs";
import { buildPrompt } from "../lib/summarise.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "bin", "standup.mjs");

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}\n      ${e.message}`);
    failed++;
  }
};
const eq = (a, b, m) => {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`${m || "mismatch"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};
const ok = (v, m) => {
  if (!v) throw new Error(m || "expected truthy");
};

console.log("date range");

check("--days counts back inclusively", () => {
  const r = dateRange({ until: "2026-11-18", days: 1 });
  eq(r, { from: "2026-11-18", to: "2026-11-18" }, "one day");
  eq(dateRange({ until: "2026-11-18", days: 7 }).from, "2026-11-12", "seven days");
});

check("explicit since/until wins", () => {
  eq(dateRange({ since: "2026-01-01", until: "2026-01-31" }), { from: "2026-01-01", to: "2026-01-31" });
});

check("defaults to two days", () => {
  const r = dateRange({ until: "2026-06-10" });
  eq(r.from, "2026-06-09", "yesterday and today");
});

console.log("transcripts");

const dir = mkdtempSync(join(tmpdir(), "standup-test-"));
const proj = join(dir, "C--demo");
const bots = join(dir, "C--x--claude-mem-observer-sessions");
mkdirSync(proj, { recursive: true });
mkdirSync(bots, { recursive: true });

const ent = (type, content, extra = {}) =>
  JSON.stringify({
    type,
    sessionId: "s1",
    cwd: "C:\\demo",
    timestamp: extra.ts || "2026-05-05T09:00:00.000Z",
    isSidechain: !!extra.side,
    message: {
      role: type,
      content,
      ...(extra.tool ? {} : {}),
    },
  });

const assistantWithTool = (tool) =>
  JSON.stringify({
    type: "assistant",
    sessionId: "s1",
    cwd: "C:\\demo",
    timestamp: "2026-05-05T09:05:00.000Z",
    message: { role: "assistant", content: [{ type: "tool_use", name: tool }] },
  });

writeFileSync(
  join(proj, "a.jsonl"),
  [
    ent("user", "please add pagination to the orders list"),
    ent("assistant", "done, added a page parameter"),
    assistantWithTool("Edit"),
    assistantWithTool("Bash"),
    ent("user", "<system-reminder>not a real ask</system-reminder>"),
    ent("user", "[Earlier usage-limit notes no longer apply.]"),
    ent("user", "ok"),
    ent("assistant", "sidechain noise", { side: true }),
    "not json",
  ].join("\n")
);
writeFileSync(join(bots, "b.jsonl"), [ent("user", "bot transcript")].join("\n"));

check("bot transcripts are excluded", () => {
  eq(findTranscripts(dir).length, 1, "only the real project");
});

const s = await readSession(join(proj, "a.jsonl"), { from: "2026-05-01", to: "2026-05-31" });

check("reads a session", () => {
  ok(s, "no session returned");
  eq(s.cwd, "C:\\demo", "cwd");
});

check("counts edits separately from other tools", () => {
  eq(s.edits, 1, "one edit");
  ok(s.tools.some(([t]) => t === "Bash"), "bash recorded");
});

check("keeps the human ask", () => {
  ok(s.asks.some((a) => a.includes("pagination")), "real ask missing");
});

check("drops harness-injected messages", () => {
  ok(!s.asks.some((a) => a.includes("not a real ask")), "system reminder leaked");
  ok(!s.asks.some((a) => a.includes("no longer apply")), "bracketed notice leaked");
});

check("drops sidechain turns", () => {
  ok(!s.asks.some((a) => a.includes("sidechain")), "sidechain leaked");
});

check("a session outside the range yields nothing", async () => {
  const none = await readSession(join(proj, "a.jsonl"), { from: "2030-01-01", to: "2030-01-02" });
  eq(none, null, "should be null");
});

console.log("git");

check("a non-repo yields no commits", () => {
  eq(isRepo(dir), false, "temp dir should not be a repo");
  eq(gitLog(dir, { from: "2026-01-01", to: "2026-12-31" }), [], "no commits");
});

console.log("ai prompt");

check("prompt carries the facts and frames them as data", () => {
  const p = buildPrompt({
    range: "2026-05-05",
    projects: [
      {
        project: "C:\\demo",
        commits: [{ subject: "add pagination", files: 2, ins: 10, del: 1 }],
        sessions: 1,
        edits: 1,
        asks: ["please add pagination to the orders list"],
      },
    ],
  });
  ok(p.includes("add pagination"), "commit missing");
  ok(p.includes("not instructions"), "injection framing missing");
  ok(p.includes("Do not infer outcomes"), "honesty rule missing");
});

console.log("cli");

const run = (args) => {
  try {
    return execFileSync(process.execPath, [CLI, ...args, "--projects", dir, "--no-git"], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
  } catch (e) {
    return (e.stdout || "") + (e.stderr || "");
  }
};

check("reports the session", () => {
  const out = run(["--since", "2026-05-01", "--until", "2026-05-31"]);
  ok(out.includes("demo"), `project missing:\n${out}`);
  ok(out.includes("pagination"), "ask missing");
});

check("an empty range says so", () => {
  ok(run(["--since", "2030-01-01", "--until", "2030-01-02"]).includes("nothing found"), "no message");
});

check("--md emits Markdown", () => {
  const out = run(["--since", "2026-05-01", "--until", "2026-05-31", "--md"]);
  ok(out.includes("# Standup"), "no heading");
  ok(!out.includes("\u001b["), "should not colour markdown");
});

check("--json emits valid JSON", () => {
  const o = JSON.parse(run(["--since", "2026-05-01", "--until", "2026-05-31", "--json"]));
  ok(o.projects.length >= 1, "projects");
  eq(o.range.from, "2026-05-01", "range");
});

check("--json does not dump raw asks per session", () => {
  const o = JSON.parse(run(["--since", "2026-05-01", "--until", "2026-05-31", "--json"]));
  ok(!("asks" in o.sessions[0]), "session asks should be stripped");
});

check("--help works", () => {
  ok(
    execFileSync(process.execPath, [CLI, "--help"], { encoding: "utf8" }).includes("what did I actually do"),
    "help text"
  );
});

rmSync(dir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
