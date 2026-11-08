# Usability review: orders-mobile.html ("My Orders")

## Scope and assumptions
- Screen: order list plus delivery-address form on one page. Platform: phone, touch only, so there is no hover.
- Users: end customers, occasional, no training.
- Main tasks: (1) check an order's status, (2) change the delivery address, (3) cancel an order.
- Assumptions: the address in the form is a profile-level address. It is not clear whether it applies to one order or to all. The backend returns a normal status and error codes. Cancelling is irreversible, or at least costly to undo.
- Method: single evaluator (no subagents), one pass per task, then a second pass per principle cluster (K1-K15). Reliability is lower than with independent passes. Findings tagged [needs user validation] are T/U judgements (K6, K8, K10, K13).
- Out of scope: full WCAG audit, visual style.

## Findings

### 1. K9 / K15 · `.row-actions` (CSS lines 17-18) · Severity 4
- Observation: Edit and Cancel are `visibility:hidden` until `.order:hover`. Touch has no hover, so on a phone the cancel and edit functions are effectively unreachable. A tap may trigger a sticky hover, but that is unreliable and invisible to the user. This blocks the "cancel an order" task.
- Fix: Always show the actions, or make the row tappable to open an order detail screen with a clearly labelled "Cancel order" button. Do not depend on hover.

### 2. K3 / K5 / C1 · `cancelOrder()` (lines 85-88), button line 34 etc. · Severity 4
- Observation: One tap on the trash icon immediately sends DELETE. There is no confirmation, no naming of the order or the consequence, and no undo. This is a destructive, probably irreversible action placed 4 px from "Edit".
- Fix: Move cancel off the list row to the detail screen, away from frequent actions. Show a dialog that names the object and consequence ("Cancel order #1042 Desk lamp? This cannot be undone." with buttons "Cancel order" and "Keep order"). Alternatively offer an undo toast, which is preferable if the backend can delay the deletion (C1: undo first, confirm only when irreversible and rare).

### 3. K1 / K4 · `cancelOrder()` (lines 86-87) · Severity 4
- Observation: The row is removed from the DOM without checking `res.ok` and without try/catch. If the request fails (offline, 500, order already shipped), the order disappears and the user wrongly believes it is cancelled. There is also no feedback during the request and no closure message.
- Fix: Disable the button and show progress while the request runs. Remove the row or change its status to "Cancelled" only after a successful response. On failure, show a message with cause and fix ("Could not cancel, no connection. Try again."). Confirm success with visible text, and keep the order visible as "Cancelled" instead of deleting it (K11).

### 4. K4 / K5 · submit handler catch block (lines 78-81) · Severity 4
- Observation: On any failure `form.reset()` wipes everything the user typed, and the only message is "Error: HTTP 500". It gives no cause or fix, uses a technical code, and forces the user to retype the whole address (and the courier note) on a phone keyboard.
- Fix: Never reset on error. Keep the values, show a plain message ("Your address was not saved because the connection failed. Your entries are kept. Try again."), mark the faulty field if it is a validation error, and move focus to the message or field.

### 5. K14 / K8 · `.status-dot` (lines 13-16, 31, 38, 45) · Severity 3
- Observation: Order status is shown only as a 10 px coloured dot (green/amber/red) with no text. Meaning is conveyed by colour alone, and the dots are invisible to colour-blind users and say nothing to anyone. Amber `#f9a825` on white is about 2:1, below the 3:1 floor for meaningful graphics. The user's actual question ("where is my order?") is not answered. There is no status wording such as "Shipped", no delivery date, and the meaning of "failed" is unclear. Using red for "failed" next to a trash icon also invites mistakes.
- Fix: Show a text status label per order ("Open, arrives Tue 12 Nov", "Delayed", "Payment failed") with the dot as redundant reinforcement. Meet the 3:1 contrast. Add an explanation of delayed/failed with the next step.

### 6. K15 · `.icon-btn` (line 19) · Severity 3
- Observation: The buttons are 20x20 px with a 4 px gap, against a touch floor of 44x44 (HIG/WCAG 2.5.5) or 48 dp. Edit and the destructive Cancel are adjacent, so mis-taps are likely and the mis-tap can delete an order. Combined with finding 2 it is dangerous.
- Fix: At least 44x44 px targets. Separate Cancel from Edit by distance and style (e.g. text button in the detail view, not an icon in the row).

### 7. K9 / K2 · icons and `title` (lines 33-34) · Severity 3
- Observation: The pencil and trash glyphs carry their meaning only through `title`, which is a hover tooltip and does not appear on touch. There is no visible text and no accessible name, since the emoji is the content. A trash can for "Cancel order" is also a mismatch: users read it as "delete" or "remove from my list", not "cancel the purchase". "Edit" is ambiguous as well, because it is unclear what is edited (items? address? date?).
- Fix: Use visible text labels ("Change address", "Cancel order"). Add `aria-label` if icons remain.

### 8. K8 / K7 · address form (lines 53-64) · Severity 3 [needs user validation]
- Observation: The form is detached from the orders. It is unclear whether the address changes a single order or all future orders, and the user cannot tell which order it refers to. The task "change the delivery address" is not found in the order. The fields are empty, so the current address is not shown (the user must recall it, and cannot see what they are changing). The row's "Edit" leads somewhere else (`/orders/ID/edit`) and may also edit the address, which means two paths to the same task (K2/C2).
- Fix: Put "Change delivery address" inside the order detail, prefilled with the current address, with a statement of its scope ("for order #1042"). Disable it for orders that already shipped, with an explanation. Keep one path.

### 9. K2 / K3 / C1 · `confirm()` (line 73) · Severity 2
- Observation: Saving an address triggers a blocking native dialog "Are you sure you want to save your address?". This is a routine, reversible action, so the confirm is noise that trains users to click through. The wording is generic (OK/Cancel), and a modal is used for a normal step (K1: report normal states inline). It also contrasts with finding 2, where the dangerous action has no confirmation at all: confirmations are on the wrong action.
- Fix: Remove it. Save directly and show inline "Address saved" with an undo or edit option. Spend confirmation on the cancel action instead.

### 10. K1 / K4 · `#msg` and submit button (lines 23, 63, 65, 77) · Severity 2
- Observation: No pressed/busy state and no double-submit guard on "Save address", and nothing signals progress on a slow mobile connection. The result message sits below the form, outside the viewport after tapping the button on a small screen, is not announced (no `aria-live`), and is never cleared or styled differently for error versus success. Error vs success is only distinguishable by the word "Error:".
- Fix: Disable the button and show "Saving..." while the request runs. Put the message next to the button, use `role="status"`/`aria-live`, scroll it into view, and style error and success differently (text plus icon).

### 11. K3 · address inputs (lines 55-62) · Severity 2
- Observation: No input constraints: no `required`, no `inputmode="numeric"` or `pattern` on postcode, no `type`. A single `autocomplete="street-address"` on a "Street and number" field is also mismatched (that token is for the full multi-line address). Invalid or empty addresses can be submitted and only fail after the round trip, which then wipes the form (finding 4).
- Fix: Mark required fields, set `inputmode`/`pattern` for postcode, use `address-line1` for the street, and validate inline next to the field before sending.

### 12. K3 · cancel offered for every order (lines 34, 41, 48) · Severity 2 [needs user validation]
- Observation: Cancel (and Edit) is offered on every order regardless of status, including failed ones (#1044) and, presumably, already shipped or delivered ones. Invalid choices should be excluded, not reported afterwards.
- Fix: Offer actions only where valid (hide or disable with a reason: "Already shipped, cannot be cancelled. Contact support.").

### 13. K8 / K12 · order rows (lines 30-50) · Severity 2 [needs user validation]
- Observation: Rows show only number and product name. There is no order detail, tracking, date or price, and the row is not tappable. The main task "check status" has no depth beyond a dot, and the primary tap target (the row itself) does nothing.
- Fix: Make the whole row a link to an order detail with status, delivery estimate, address, and the order-specific actions.

### 14. K14 · label text (line 20), minor · Severity 1
- Observation: Field labels are 14 px and body text is the default colour `#222` on white (fine). Labels are small for a phone, though input text is 16 px, which correctly avoids iOS zoom.
- Fix: Raise labels to 16 px.

## Summary
- 14 findings: severity 4 x 4 (1, 2, 3, 4), severity 3 x 4 (5, 6, 7, 8), severity 2 x 5 (9, 10, 11, 12, 13), severity 1 x 1 (14).
- Priority: the cancel flow (1, 2, 3, 6, 7) and the failed-save data loss (4) before release. Then status visibility (5) and the address flow (8-11).
- Needs user validation: findings 8, 12, 13 (K8 task fit). Whether the 4 px adjacent trash button leads to real mis-cancellations should be checked in a usability test.
