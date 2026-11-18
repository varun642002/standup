<div align="center">

# 🗣️ standup

### What did I actually do?

*Your git history and Claude Code sessions already know. This reads them back.*

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue.svg)](package.json)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](#)
[![Tests](https://img.shields.io/badge/tests-18-success.svg)](test/smoke.mjs)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

Standup is in four minutes and yesterday is a blur. You know you fixed
something important. You cannot remember which repo.

```console
$ standup

standup  ·  2026-11-17 → 2026-11-18

  erp
    9abc211 Shop shelves show real low stock as red bins; daily report records
            Meta's full error and cannot double-send (5 files, +64/-9)
    cc6725c Add a full README: features by module, roles, architecture, deploy
    24 sessions, 15 edits
      · add a good and big readme for this erp

  api-service
    f4b6407 Move the backend off Cloud SQL to Firestore (29 files, +688/-1344)
    2 sessions, 12 edits
      · this is costing more in cloud console

  4 commit(s), 26 session(s), 2 project(s)
```

🔒 Local by default. Nothing is sent anywhere unless you pass `--ai`.

## 🚀 Install

```bash
npx @varun642002/standup
```

Or clone it — there's nothing to build:

```bash
git clone https://github.com/varun642002/standup && node standup/bin/standup.mjs
```

## 🎮 Usage

```bash
standup
```

```bash
standup --days 7
```

```bash
standup --since 2026-11-01 --until 2026-11-07
```

| Flag | Effect |
|---|---|
| `--days N` | Days back, including today (default 2) |
| `--since` / `--until` | Explicit range, `YYYY-MM-DD` |
| `--project TEXT` | Only projects whose path contains TEXT |
| `--md` | Markdown — paste into Slack or a doc |
| `--json` | Machine-readable |
| `--ai` | Rewrite as prose with a model |
| `--model NAME` | Model for `--ai` (default `claude-haiku-5-5`) |
| `--no-git` / `--no-sessions` | Use only one source |
| `--projects DIR` | Transcripts directory |

For a weekly summary you can paste straight into Slack:

```bash
standup --days 7 --md > week.md
```

## 🤖 The --ai flag

Without it you get the facts: commits, counts, and what you asked for. With it,
a cheap model turns those facts into prose.

```bash
standup --ai
```

The prompt is written to keep it honest — it's told to state only what the
record supports and **not** to claim anything was finished, tested or deployed
unless the record says so. It costs about a cent, and the transcript is sent to
the model, so skip it on sensitive work.

## 🧭 How it works

Two sources, joined by project directory:

| Source | What it gives |
|---|---|
| **git** | Commits in the range, with files changed and line counts, filtered to your own `user.email` |
| **Claude Code transcripts** | Which projects you worked in, how many sessions, how many file edits, and what you asked for |

Repos are discovered from the projects your sessions touched, plus the current
directory — so you don't list them.

### Three things that make the output readable

Each came from running this against real history:

1. **Machine transcripts are excluded.** Tools that summarise your sessions
   write transcripts of their own; on the machine this was built against they
   outnumbered real sessions 20:1.
2. **Harness messages aren't asks.** Things like `[Request interrupted]` and
   system reminders arrive with the user's role but nobody typed them. Left in,
   they appear as standup items, which looks absurd.
3. **Activity isn't news.** A project with no commits and nothing worth quoting
   is dropped rather than padded with session counts.

Transcripts are streamed line by line, so hundreds of megabytes cost no more
memory than a few kilobytes.

## 🤝 Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). No dependencies, please.

- [ ] Jira / Linear / GitHub issue activity as a third source
- [ ] Post straight to a Slack webhook
- [ ] `--since-last` — everything since the last time you ran it
- [ ] Group by day instead of by project

## 📄 License

[MIT](LICENSE)
