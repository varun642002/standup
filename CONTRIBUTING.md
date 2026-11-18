# Contributing to standup

## The one rule

No dependencies. A PR that adds one needs to say what it buys.

## Setup

```bash
git clone https://github.com/varun642002/standup && cd standup && node test/smoke.mjs
```

There is no build step.

## Before a PR

```bash
node test/smoke.mjs
```

Tests write to a temp directory and never touch your real transcripts or repos.
CI runs them on Linux, macOS and Windows against Node 18, 20 and 22.

## Things to know

- **Stream, never read whole files.** Single transcripts reach hundreds of MB.
- **Not every "user" message is from a user.** Harness notices, pasted blocks
  and system reminders carry the user role. `NOT_A_HUMAN_ASK` in
  `lib/collect.mjs` filters them; a leak shows up as a nonsense standup item.
- **Machine transcripts are excluded.** Session-summarising tools write their
  own and can outnumber real sessions 20:1.
- **Activity is not news.** A project with no commits and nothing quotable is
  dropped, not padded with counts.
- **`--ai` must not overclaim.** The prompt forbids inferring that anything was
  finished, tested or deployed. Keep that rule if you touch it — an honest
  standup is the whole point.
- **Defaults must agree.** `dateRange`'s default and the CLI's documented
  default are the same number; a test enforces it.
