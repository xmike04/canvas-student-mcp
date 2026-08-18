---
name: canvas-morning-check
description: "Daily Canvas briefing — what's due soon, new announcements, unread messages, and newly posted grades or feedback across all courses. Use when the user asks what's going on with school today, wants a course catch-up, or says good morning and has coursework."
---

# Canvas morning check

Produce a short daily briefing from Canvas. Lead with anything urgent; keep the whole thing scannable in under thirty seconds.

## Steps

1. **Verify the connection.** Call `canvas_auth_status`. If `status` is not `ok`, report the `action_required` message and stop — everything below will fail otherwise.
2. **Gather in parallel** (independent calls, issue them together):
   - `canvas_list_planner` with `days_ahead: 7` — upcoming work and new activity
   - `canvas_list_announcements` — recent posts across active courses
   - `canvas_list_inbox` with `scope: "unread"` — messages needing a reply
   - `canvas_get_feedback` — newly graded work and grader comments
3. **Check for silent trouble.** In the planner results, anything with `status: "missing"` is a missed submission — surface it first, even if the due date has passed.

## Output

Write it as prose with short bulleted lists, not a wall of JSON. Structure:

- **⚠️ Needs attention** — missing submissions, anything due in the next 48 hours, unread messages from an instructor or TA. Omit this section entirely when it's empty rather than writing "nothing."
- **📅 This week** — remaining deadlines in date order, each as `Course — item — day/time`. Convert UTC timestamps to US Central; Canvas due times of 04:59 or 05:59 UTC mean 11:59 PM the *previous* day.
- **📣 New since yesterday** — announcements and newly posted grades, one line each with the key fact (not a summary of the whole post).

Close with one sentence naming the single most important thing to do today. If nothing is urgent, say so plainly — a quiet day is a useful answer.
