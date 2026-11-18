# Compaction carry-over

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-green)](https://github.com/topics/dsh-plugin)

Context compaction replaces earlier history with one summary. Skills that were
loaded and subagents that were spawned disappear with it: after compaction the
agent no longer knows what to re-read or which child sessions it can reuse.

This plugin asks the compaction summarizer — the only participant that still
sees the whole conversation — to record that information in the checkpoint it
writes:

```markdown
## Carry-over
- Skills in effect: `agent-organizer` — still governs delegation for the stand build.
- Subagents: `15e1006c-0b88-4a25-9063-8f69d551718c` — Kubernetes deploy, reusable.
```

Nothing is injected into the conversation and no extra model call is made. The
requirement is appended to the summarizer instruction of the call that was
already happening.

## Install

```sh
dsh plugin --profile <profile> add dsh-compaction-carryover
```

For a local checkout:

```sh
dsh plugin --profile <profile> add link:/path/to/dsh-compaction-carryover
```

Restart DSH after installing.

## Configure

```yaml
- insert:
    - id: compaction-carryover
      name: 'dsh-compaction-carryover'
      config:
        enabled: true
        sectionTitle: '## Carry-over'
        extraInstructions: ''
        debug: false
```

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Turn the plugin on or off. |
| `sectionTitle` | `## Carry-over` | Heading the checkpoint must contain. |
| `extraInstructions` | `''` | Additional requirements appended to the instruction. |
| `debug` | `false` | Write diagnostics to `~/.dsh/compaction-carryover.log`. |

## Check it works

Run `/compact` in a session that has loaded a skill or spawned a subagent, then
look at the checkpoint: it should contain the `## Carry-over` section.

If a checkpoint is written without that section, the host log reports it:

```
[dsh-compaction-carryover] checkpoint <id> (session <id>) has no "## Carry-over" section;
the summarizer ignored the instruction
```

With `debug: true` the plugin also records whether the instruction was extended
and whether the section was found.

## Limitations

- This is an instruction to the model, not a guarantee. A checkpoint can still
  omit the section; the log above is how you notice it.
- It relies on the summarizer marking its call with `purpose: "compaction"`,
  which the default `dsh-compaction-basic` backend does. Other compaction
  backends are not covered.
- Requests the agent freezes are left untouched.

## License

MIT
