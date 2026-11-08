# Evals

The evals compare agents **with** the `usability-hci` skill against a **baseline without** it. Run date: 2026-11-08.

## Setup

- **Tasks** ([tasks.md](tasks.md)):
  - B1: contact form with validation;
  - B2: delete flow for an object with dependencies;
  - B3: CSV import running from 10 s to several minutes;
  - R1: review of [fixtures/orders-mobile.html](fixtures/orders-mobile.html). The fixture contains five planted defects: a confirmation on a routine save, the form cleared on error, actions only on hover, status shown only by colour, and 20 px touch targets.
- **Runs.** There was one run per task and condition, eight in total. Each run was a fresh Claude Code subagent on Sonnet. The skill runs read `SKILL.md` first; the baseline runs were not allowed to read the repository. Nobody was available to answer questions, so the runs had to state their assumptions.
- **Grading.** One grader graded blind; its per-item scores are in [results/grading.md](results/grading.md). The grader was a fresh Opus subagent, read-only, and saw only the anonymised outputs (X/Y, shuffled per task; mapping in [results/blind-mapping.json](results/blind-mapping.json)), the [rubric](rubric.md), and the fixture. The rubric has ten items per build task, each scored 0–2, and five planted defects for the review, each scored 0–2 for found plus correctly attributed.
- **Outputs.** The raw outputs are in [results/outputs/](results/outputs/).

## Results

| Task | With skill | Without skill | Main differences (grader) |
|---|---|---|---|
| B1 contact form | **20/20** | 17/20 | Baseline: mixed required/optional marking; phone error without a fix; focus on a 422 fails because the inputs are still disabled |
| B2 delete flow | **20/20** | 14/20 | Skill: archive as the primary safe path with an Undo toast; Delete spatially separated; errors with cause and next step. Baseline: Delete next to Cancel in the primary position, no outcome feedback, no undo |
| B3 CSV import | **20/20** | 17/20 | Baseline: stale cancel confirmation with destructive auto-focus; static "indeterminate" bar; generic upload errors |
| R1 review | 10/10 | 10/10 | Both found all five defects with fitting attributions. Skill: 1–3 K/C IDs per finding from one fixed scheme, calibrated severities (grader), method and limits stated, user-validation flags. Baseline: 1–3 heuristic names per finding from varying schemes, slightly inflated severities |
| **Total** | **70/70** | **58/70** | |

R1 with the skill attributed the planted defects as follows (finding numbers from [results/outputs/R1-skill/review.md](results/outputs/R1-skill/review.md)):
- confirmation on save (#9): `K2 / K3 / C1`;
- `form.reset()` on error (#4): `K4 / K5`;
- hover-only actions (#1): `K9 / K15`;
- colour-only status (#5): `K14 / K8`;
- 20 px targets (#6): `K15`.

Every set contains the expected ID (C1, K4, K9, K14, K15).

## Triggering

The trigger test ran headless Claude Code (`claude -p`, 2.1.319, `--max-turns 1`) in a scratch project. The skill was installed in `.claude/skills/`, alongside the user's normal plugins and skills, including `frontend-design`.

| Prompt | Skill loaded? |
|---|---|
| Add a newsletter signup form with email validation | yes |
| Review the checkout flow for usability problems | yes |
| Settings page shows a "Saved successfully" modal after every save – improve the interaction | yes |
| Implement a progress indicator for a video export (up to 2 min) | yes |
| Add a password reset form (skill symlinked into `.claude/skills/`) | yes |
| Add a database index migration | no |
| Python ISO 8601 parser with unit tests | no |
| Refactor Express auth middleware to async/await | no |
| Add retry with exponential backoff to a Kafka consumer | no |

Result: 5 of 5 UI prompts triggered the skill, and 0 of 4 backend prompts did. Codex CLI listed the skill when it was symlinked into `.agents/skills/`.

## Limits

- **Sample size.** n = 1 per task and condition, so the results show a direction, not statistical significance.
- **Unbalanced shuffle.** The skill output was "X" in 3 of 4 tasks (B1, B2, R1).
- **Rubric bias.** The rubric was written by the same agent that wrote the skill and is derived from the same principles, which favours the skill condition. The grader was blind to the condition, but could infer it from K-IDs in the review outputs.
- **Model.** The runs used Sonnet. The baseline is already strong, so the skill's gain is mainly in consistency, in proportionate protection of destructive actions (C1), and in error recovery (K4/K5).
- **Not checked.** The generated components were not compiled or run.
