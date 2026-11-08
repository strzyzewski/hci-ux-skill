# Blind grading – per-item scores

- **Grader:** fresh Opus subagent, read-only. It saw only `blind/<task>/{X,Y}`, the rubric, and the fixture.
- **Scale:** 0 = absent or wrong, 1 = partial, 2 = fully met.
- **Scope of the tables:** the grader listed only items where X and Y differ or a score is below 2. All other items are 2 for both.
- **Unblinding:** labels from [blind-mapping.json](blind-mapping.json), added after grading.

## B1 contact form – X = skill 20/20, Y = baseline 17/20

| # | Skill | Base | Justification (grader, condensed) |
|---|---|---|---|
| 1 | 2 | 1 | Baseline mixes "*" with a legend for required and the word "(optional)" for the optional field. |
| 3 | 2 | 1 | Baseline's phone error does not say how to fix it. |
| 5 | 2 | 1 | Baseline: on a 422, it focuses the field before re-rendering while the inputs are still disabled, so the focus does nothing. |

## B2 delete project – X = skill 20/20, Y = baseline 14/20

| # | Skill | Base | Justification |
|---|---|---|---|
| 1 | 2 | 1 | Skill: "Archive instead" is the primary-styled action, with an Undo toast. Baseline: archive is a plain secondary button with no undo. |
| 4 | 2 | 1 | Baseline: "Delete project permanently" sits next to Cancel, in the primary position. |
| 6 | 2 | 1 | Baseline: generic errors with no cause. |
| 8 | 2 | 0 | Baseline: no outcome feedback of its own and no undo. |
| 9 | 2 | 1 | Baseline: archive is unavailable when the dependency request fails. |

## B3 CSV import – X = baseline 17/20, Y = skill 20/20

| # | Skill | Base | Justification |
|---|---|---|---|
| 2 | 2 | 1 | Baseline: stale cancel confirmation, with destructive auto-focus on the next import. |
| 3 | 2 | 1 | Baseline: the "indeterminate" bar is a static 30 % block. |
| 7 | 2 | 1 | Baseline: "File is empty" gives no fix, and all upload failures say "check your connection". |

## R1 review – X = skill 10/10, Y = baseline 10/10

Both found all five planted defects with fitting attributions.

**Severity calibration.** The grader rated the skill run as better calibrated:
- data loss and hover-only actions at 4;
- colour-only status and target size at 3;
- the redundant confirmation at 2.

The baseline's severities were slightly inflated.

**False positives:**
- Skill: none clear. Finding 14 (14 px labels) is marginal.
- Baseline: findings 12 and 13 are borderline or generic.

## Bugs the grader noted outside the rubric

**Skill outputs:**
- B1 keeps a localStorage draft with no expiry, a privacy concern on shared devices.
- B2's toast timers are never cleared.
- B2's undo has no busy guard.

**Baseline outputs:**
- B1 drops keyboard focus while sending.
- B1's dark-mode button contrast is about 2.4:1.
- B3 has no polling backoff.
