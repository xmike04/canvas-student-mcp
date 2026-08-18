---
name: canvas-week-plan
description: "Plan the week's coursework from Canvas — every deadline across courses, ordered and grouped by day, with what each task actually requires. Use when the user asks to plan their week, wants to know what's coming up, or asks how to schedule study time."
---

# Canvas week plan

Turn Canvas deadlines into a plan the user can act on, not just a list of dates.

## Steps

1. Call `canvas_list_planner` with `days_ahead: 14` for the full picture across courses.
2. For anything substantial (a project, an exam, a multi-part assignment), call `canvas_get_assignment` to read what it actually asks for — the plan is only useful if it reflects the real work.
3. When a deadline references course material (a reading, a lecture deck, a lab handout), use `canvas_read_file` or `canvas_read_syllabus` to check what it covers, so effort estimates aren't guesses.
4. Call `canvas_get_grades` or `canvas_grade_breakdown` to see what each item is worth. A 20% exam and a 2-point quiz should not get equal space in the plan.

## Output

Group by day, Monday through Sunday, using the user's local time (US Central unless told otherwise — Canvas due times of 04:59/05:59 UTC mean 11:59 PM the previous day).

For each day, list the items due with:
- Course and item name
- Points, and the share of the final grade when it's material
- A realistic sense of the work required, based on what you actually read

Then add:
- **Start early on:** anything where the work clearly exceeds the time left if begun the night before
- **Low stakes:** items worth little, so the user can triage under pressure

Prefer honesty over completeness — if two deadlines collide on the same evening, say so directly. Skip filler sections when there's nothing to put in them. If the week is genuinely light, a three-line answer is the right answer.
