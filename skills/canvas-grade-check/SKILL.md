---
name: canvas-grade-check
description: "Check grade standing across Canvas courses and answer what-if questions like what score is needed on the final for an A. Use when the user asks about grades, GPA impact, whether they can still pass, or what they need on remaining work."
---

# Canvas grade check

Report where the user actually stands, and answer the question behind the question — usually "am I okay?" or "what do I need to get?"

## Steps

1. `canvas_get_grades` with no arguments for the cross-course overview.
2. `canvas_grade_breakdown` per course for the detail: group weights, what's graded, what's outstanding. Pass `target_grade` when the user names a goal (90 for an A, 80 for a B, or whatever they say).
3. `canvas_get_feedback` when a score looks low — the grader's comments usually explain it, and that's more useful than the number.

## Reading the results correctly

- **Distinguish "0" from "not yet graded."** A gradebook placeholder or an ungraded item is not a failing grade. Say which one it is; never report an unearned zero as the user's standing.
- **Respect the caveats.** `canvas_grade_breakdown` returns a `caveats` array when drop rules, unposted assignment groups, or a mismatch with Canvas's own number make a projection unreliable. Repeat those caveats in your answer — a confident wrong projection about someone's GPA is worse than an honest uncertain one.
- **Trust Canvas for the official number.** When `current_grade_computed` and `canvas_reported_current_score` disagree, report Canvas's figure as authoritative and note the difference.
- **Early semester:** if little is graded, say the number isn't meaningful yet and pivot to what's coming.

## Output

Per course: current standing (or "nothing graded yet"), then what remains and what it's worth. For a what-if question, give the direct answer first — "you need a 84% average on the remaining work" — then the arithmetic behind it briefly.

If a target is out of reach, say so plainly and give the best still-achievable outcome. Don't soften it into something misleading.
