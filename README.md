# usability-hci – a Claude Code / Codex skill

An agent skill that holds coding assistants to **classical, research-based usability and HCI principles** when they build or review user interfaces.

The principles come from Shneiderman, Nielsen, Norman, ISO 9241-110, Tognazzini, Cooper (*About Face*), Raskin, Apple HIG 1987/1992, Smith & Mosier, Johnson, and Gerhardt-Powals. The empirical basis is response-time limits, Fitts' law, and KLM. The skill deliberately leaves out visual design, branding, engagement, and persuasive design.

- **Mode A – Build:** clarify context, apply 15 rules (K1–K15), resolve conflicts with C1–C5, then self-check the MUST rules against the diff.
- **Mode B – Review/Rehaul:** walk the main tasks, record findings as `ID · location · observation · severity 0–4 · fix`, optionally run independent passes and merge them, and write `UX-REVIEW.md` for larger rehauls.

## Layout

```
.claude-plugin/              Claude Code plugin manifest + single-plugin marketplace
skills/usability-hci/
├── SKILL.md                 skill core (rules, modes, conflicts, platform table)
└── references/
    ├── principles.md        full principle table: sources, evidence, testability, conflicts, literature
    ├── platform-params.md   target sizes, response times, contrast – per platform, with derivation
    ├── review-procedure.md  review method, severity, finding format, multi-pass merge, UX-REVIEW.md template
    └── data-entry.md        filtered Smith & Mosier (1986) guidelines for forms and data entry
evals/                       eval tasks, fixture, rubric, and results (with vs. without skill)
```

## Install

### Claude Code – as a plugin (recommended)

```bash
claude plugin marketplace add strzyzewski/hci-ux-skill
claude plugin install usability-hci@hci-ux-skill
```

### Claude Code – as a personal or project skill

```bash
git clone https://github.com/strzyzewski/hci-ux-skill.git ~/src/hci-ux-skill
ln -s ~/src/hci-ux-skill/skills/usability-hci ~/.claude/skills/usability-hci     # personal
# or, inside a project:
ln -s ~/src/hci-ux-skill/skills/usability-hci .claude/skills/usability-hci        # project
```

### Codex CLI

```bash
mkdir -p ~/.agents/skills
ln -s ~/src/hci-ux-skill/skills/usability-hci ~/.agents/skills/usability-hci      # personal
# or, inside a project:
ln -s ~/src/hci-ux-skill/skills/usability-hci .agents/skills/usability-hci        # project
```

The frontmatter contains only `name` and `description`, so the same folder works in both runtimes. Locations were checked against the current documentation on 2026-11-08:
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/plugins/marketplace-reference
- https://agentskills.io/specification
- https://developers.openai.com/codex/skills

Symlink discovery was tested in Claude Code 2.1.319 and Codex CLI.

## Usage

The skill triggers automatically on UI work, for example "build a signup form", "add a progress indicator for the export", or "review the checkout flow for usability problems". It does not trigger on backend-only tasks. You can also invoke it explicitly:
- **Claude Code:** `/usability-hci`; when installed as a plugin, the name is namespaced as `/usability-hci:usability-hci`.
- **Codex:** name the skill in your prompt.

## Evals

See [evals/README.md](evals/README.md). The skill was compared with a baseline without the skill on three build tasks and one review task, graded blind, and its triggering was tested with headless Claude Code runs.

## Sources and copyright

All principles are paraphrased in our own words; no book passages are reproduced. Sources and links are in [references/principles.md](skills/usability-hci/references/principles.md). Items marked **[verify]** there are still to be checked against the original editions.

## License

MIT – see [LICENSE](LICENSE).
