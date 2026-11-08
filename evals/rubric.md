# Grading rubric (score each item 0 = absent/wrong, 1 = partial, 2 = fully met, judged from the code itself, not from comments or claims)

## B1 Contact form (fields: name*, email* valid format, phone optional, message*; POST /api/contact -> 201 | 422 {errors} | 5xx; desktop+mobile)
1. Every field has a persistent visible label (placeholder is not a label); required vs optional marked in text, consistently.
2. Validation timing is non-disruptive: no error shown while the user is still typing a field for the first time (on blur/submit is fine).
3. Error messages per field state what is wrong and how to fix it, in plain user language.
4. On 422 and on 5xx/network errors, all user input is preserved (nothing reset/cleared).
5. After a failed submit, focus moves to the first error (or an error summary linking to fields); errors are marked at the field.
6. Double submission is prevented while sending, and there is a visible busy state.
7. Success is confirmed inline (no modal, no automatic redirect).
8. Errors are not conveyed by colour alone (text and/or icon).
9. Input is tolerant: email trimmed, case not an issue, phone not over-restricted; appropriate input types/autocomplete.
10. Touch targets for the submit control and inputs are at least 44 px high on touch layouts.

## B2 Delete project with dependencies (GET dependencies; DELETE permanent; archive/unarchive exist; daily use by team leads)
1. A reversible alternative (archive, with undo/unarchive) is offered and made the easy/primary path.
2. Permanent delete is protected proportionally: confirmation only for the irreversible action, naming the concrete project and the consequence (dependency counts), not a generic Yes/No.
3. Dependency counts are fetched and shown before the user commits; failure to load them blocks the irreversible action or is handled safely.
4. Destructive control is visually and spatially separated from safe/frequent controls; safe option has initial focus.
5. Busy state and double-trigger guard on archive/delete requests.
6. Error messages state problem, cause and next step; dialog/state preserved on error (nothing lost).
7. There is always a visible exit (Cancel/Esc) that leaves no half-done state.
8. Outcome feedback is inline/non-modal (e.g. toast), including undo for the archive action.
9. Proportionality: the flow does not add friction to routine, reversible actions (e.g. no confirm dialog for archive).
10. Wording uses user vocabulary (no internal jargon); status/severity not conveyed by colour alone.

## B3 CSV import (> 10 s up to minutes; POST /api/imports; GET status {processed,total,errors}; DELETE cancels; occasional desktop use)
1. Percent-done progress with counts (processed/total) is shown during the run.
2. A working Cancel is available during the run and calls DELETE; the cancel outcome is reported.
3. Indicator appears for the upload phase / before totals are known (indeterminate state), within ~1 s.
4. Non-blocking: the progress is not shown in a blocking modal; the user is not trapped.
5. Start is guarded against double triggering; pressed/busy state.
6. Work is protected: reload/network loss does not lose track of the running import, or the file selection is kept after a failed upload.
7. Errors (file-level and row-level) state what is wrong and how to fix it; row errors are listed with row numbers.
8. Completion is explicitly confirmed with a summary (imported/skipped), with a clear next step (closure).
9. Status/results are not conveyed by colour alone.
10. Wording is in user vocabulary; the flow has a clear start, progress, end.

## R1 Review of orders-mobile.html (fixture). Five planted defects; for each, score 2 if found AND attributed to a fitting principle (for skill-style IDs the expected ID is in brackets; for other naming accept an equivalent canonical heuristic), 1 if found but mis-attributed or vague, 0 if missed.
1. Routine "Save address" asks "Are you sure...?" confirmation [C1 and/or K5; K12 acceptable].
2. On server error form.reset() clears the user's input [K4; K5 acceptable].
3. Edit/Cancel order actions only visible on :hover (not reachable on touch) [K9].
4. Order status conveyed only by a coloured dot [K14].
5. Icon buttons are 20x20 px, too small for touch [K15].
Additionally note (not scored, report separately): severity plausibility, extra valid findings, false positives.
