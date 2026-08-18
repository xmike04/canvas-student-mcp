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

### v1.2 — Tier 2 (5 tools)
- **`canvas_read_file`** — extracts text from course materials. PDFs use `unpdf`; `.docx`, `.pptx`, and `.xlsx` are handled in-repo by a small ZIP reader over Node's built-in `zlib`, since OOXML files are just ZIP archives of XML — three formats, no dependency. Unsupported types fail with a pointer to `canvas_get_file_link` rather than a stack trace.
- **`canvas_read_syllabus`** — returns the syllabus as text whether it's inline HTML or an attached file, detecting the link-only case and reading the attachment. Validated against all three shapes: PDF attachment, DOCX attachment, and inline text.
- **`canvas_list_groups`**, **`canvas_get_module_progress`** (completion requirements, with an `incomplete_only` filter), **`canvas_list_peer_reviews`**.

Building this surfaced a second cookie-auth quirk: Canvas omits the `verifier=` param from file URLs for cookie sessions, so downloads return `500` unless the session cookie is attached. Download redirects are now followed by hand so credentials stop at the Canvas host and are never forwarded to a CDN.

## Planned

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
