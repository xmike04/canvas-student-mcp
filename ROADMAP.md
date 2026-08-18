# Roadmap

Every feature here was validated against a live Canvas instance (UNT, student session auth) before being planned — the check is whether a *student-level* account can actually reach the endpoint, not whether the Canvas docs describe it. Institutions restrict different pieces (UNT blocks the Files tab and API tokens), so "documented" and "available" are not the same thing.

## Shipped

### v1.0 — core read surface (19 tools)
Courses, syllabus, assignments with submission status, grades, announcements, modules, pages, files, discussions, quizzes, to-dos, upcoming, calendar, and a full-course markdown export.

### v1.1 — Tier 1 (5 tools)
- **`canvas_list_inbox` / `canvas_get_conversation`** — read Canvas inbox threads. Passes `auto_mark_as_read=false`, so reading a thread through this server does *not* mark it read in Canvas (verified against a live unread conversation). Quoted email chains are trimmed.
- **`canvas_get_feedback`** — grader comments and rubric assessments across courses, with rubric criterion IDs resolved to their descriptions.
- **`canvas_grade_breakdown`** — grade breakdown by assignment group plus a what-if calculator. Handles both Canvas grading modes (weighted-by-group and total-points), cross-checks its own math against the score Canvas reports, and surfaces caveats when drop rules or unposted groups make a projection unreliable.
- **`canvas_list_planner`** — the Canvas planner feed, with new-activity flags and per-item submission state.

## Planned

### Tier 2 — content depth
- **File text extraction.** Syllabi are often posted as PDF/DOCX attachments rather than inline HTML (2 of 3 courses tested). The file API is reachable even where the Files *tab* is restricted, so the content is fetchable; this needs a PDF/DOCX parsing dependency and a size guard.
- **Groups** (`/users/self/groups`) — group memberships and group discussions.
- **Module progress** — `content_details` exposes completion requirements and what's left to satisfy them.
- **Peer reviews** — reachable and empty in current courses; wire up when a course assigns them.

### Tier 3 — distribution & operations
- **npm publish** so installation is `npx canvas-student-mcp`.
- **Agent skills / prompt recipes** — packaged workflows ("morning check", "week plan") in the style other Canvas MCP servers ship.
- **Keychain credential storage** instead of plaintext in the MCP client config.
- **`canvas_auth_status`** — report session validity and staleness so scheduled jobs can warn before a sync fails on an expired cookie.

## Explicitly out of scope: writes

Other Canvas MCP servers support submitting assignments, posting discussion replies, and sending messages. This server stays **read-only on purpose**:

- An agent with a bug cannot submit the wrong file, post a half-finished reply, or message an instructor by mistake.
- Every tool is a GET, which makes the security story auditable in one sentence.

If write support is ever added, it belongs behind an explicit opt-in flag (e.g. `CANVAS_ALLOW_WRITES=1`) with per-tool confirmation — never as a default.
