# canvas-student-mcp

**The Canvas LMS MCP server that works even when your school disables API tokens.**

[![CI](https://github.com/xmike04/canvas-student-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/xmike04/canvas-student-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)

Gives Claude (or any MCP client) live, **read-only** access to your Canvas account: courses, syllabus, assignments with submission status, grades, announcements, modules, pages, files, discussions, quizzes, to-dos, and calendar. Pair it with a Notion connector and archive an entire course with one prompt.

## Why another Canvas MCP?

Several good Canvas MCP servers already exist — [vishalsachdev/canvas-mcp](https://github.com/vishalsachdev/canvas-mcp), [DMontgomery40/mcp-canvas-lms](https://github.com/DMontgomery40/mcp-canvas-lms), [mtgibbs/canvas-lms-mcp](https://github.com/mtgibbs/canvas-lms-mcp), and others. **All of them require a personal API token.**

Here's the problem: many universities disable self-service token generation for students. Open *Account → Settings* and there's simply no **+ New Access Token** button. At those schools, every token-based server is a dead end.

This server solves that with **session-cookie authentication**: log into Canvas in your browser, copy the session cookie once, and you're connected. The Canvas web UI talks to the same `/api/v1` REST API with that cookie, so no admin policy can block it without breaking Canvas itself.

What that requires under the hood (and what the token-based servers don't do):

- **XSSI guard stripping** — cookie-authenticated Canvas responses are prefixed with `while(1);`, which breaks naive JSON parsing
- **Login-redirect detection** — expired sessions *redirect* to the login page instead of returning 401; the server catches redirects and non-JSON bodies and tells you exactly how to refresh, instead of failing cryptically
- **Credentialed file downloads** — token sessions get a `verifier=` param that makes file URLs self-authenticating; cookie sessions don't, so downloads must carry the session cookie (Canvas answers `500` otherwise). Redirects are followed manually so credentials are never forwarded to a CDN
- **Expiry-aware errors** — every failure mode explains the fix in the error message itself

Design principles that differentiate it beyond auth:

- **Read-only by design.** Every tool is a GET. The server physically cannot submit assignments, post discussions, or modify anything — safe to hand to an autonomous agent.
- **Context-efficient responses.** Canvas API payloads are enormous; every tool trims to the fields an LLM actually needs, converts HTML to clean text (preserving link URLs), and caps pagination with explicit truncation notices.
- **Small and auditable.** Strict TypeScript, three runtime dependencies (the MCP SDK, zod, and `unpdf` for PDF text). You can read the whole thing before trusting it with your school account.

Token auth is still supported if your school allows it — the cookie is the fallback, not the only path.

## Tools (29)

| Tool | What it does |
|---|---|
| `canvas_get_profile` | Verify credentials / who am I |
| `canvas_list_courses` | Courses with current grade (active / completed / all) |
| `canvas_get_course` | Course details + full syllabus as text |
| `canvas_list_assignments` | Assignments by due date w/ your submission status; bucket filters (upcoming, overdue, …) |
| `canvas_get_assignment` | Full description, rubric, your submission + score |
| `canvas_get_grades` | All-course grade overview, or per-assignment breakdown for one course |
| `canvas_list_announcements` | Announcements across active courses, or one course / date range |
| `canvas_list_modules` | Course content outline with items |
| `canvas_list_pages` / `canvas_get_page` | Course wiki pages, full text |
| `canvas_list_files` / `canvas_get_file_link` | Course files + temporary download URLs |
| `canvas_list_discussions` / `canvas_get_discussion` | Discussion topics and full threads |
| `canvas_list_quizzes` | Quizzes with due dates, time limits, attempts |
| `canvas_list_todo` / `canvas_list_upcoming` | Your to-do list and upcoming deadlines |
| `canvas_list_calendar_events` | Events or assignment deadlines in a date range |
| `canvas_list_inbox` / `canvas_get_conversation` | Read Canvas inbox threads — **without marking them read** |
| `canvas_get_feedback` | Grader comments and rubric assessments on your submissions |
| `canvas_grade_breakdown` | Grade by assignment group + **what-if calculator**: "what do I need on the final for an A?" |
| `canvas_list_planner` | Planner feed with new-activity flags and submission state |
| `canvas_read_file` | **Extract text from course files** — PDF, Word, PowerPoint, Excel, HTML, plain text |
| `canvas_read_syllabus` | Syllabus as text, whether it's typed into Canvas or posted as an attached PDF/Word file |
| `canvas_list_groups` | Your group memberships |
| `canvas_get_module_progress` | Module completion state and what each item still requires |
| `canvas_list_peer_reviews` | Peer reviews assigned to you |
| `canvas_export_course` | One-shot markdown export of an entire course — built for Notion archiving |
| `canvas_auth_status` | Diagnose the connection: which credential, stored where, still valid? |

Three of these are worth calling out.

**`canvas_read_file`** turns course materials into readable text, which is what makes "quiz me on this week's slides" or "what's the late-work policy" actually work. PDFs go through `unpdf`; Office formats are handled in-repo — `.docx`, `.pptx`, and `.xlsx` are ZIP containers of XML, so a small ZIP reader over Node's built-in `zlib` covers all three with no dependency. `canvas_read_syllabus` builds on it: it detects when a syllabus is only a file link and reads the attachment instead, which is the common case (2 of the 3 courses tested). **`canvas_grade_breakdown`** implements both of Canvas's grading models (weighted-by-group and total-points), cross-checks its arithmetic against the score Canvas itself reports, and tells you when drop rules or unposted assignment groups make a projection unreliable — instead of quietly returning a confident wrong number. **`canvas_get_conversation`** passes `auto_mark_as_read=false`, so an agent reading your inbox doesn't silently mark your messages read; that behavior is verified against a live unread thread, not just assumed.

See [ROADMAP.md](ROADMAP.md) for what's planned next and why writes are deliberately out of scope.

## Quick start

No install needed — `npx` fetches it on demand:

```bash
npx canvas-student-mcp
```

Or from source:

```bash
git clone https://github.com/xmike04/canvas-student-mcp.git
cd canvas-student-mcp
npm install && npm run build
```

### Get credentials

**Option A — API token** (if your school allows it): Canvas → *Account → Settings → Approved Integrations → + New Access Token*.

**Option B — session cookie** (for locked-down schools):

1. Log into your school's Canvas in any browser
2. DevTools (`Cmd/Ctrl+Shift+I`) → **Network** tab → refresh
3. Click any request to your Canvas domain → **Request Headers** → copy the full `cookie:` value
   (or just the `canvas_session=...` pair — that one cookie is sufficient)

Either credential grants read access to your Canvas account. Treat it like a password.

### Store the credential (macOS: use the Keychain)

MCP client configs are plaintext JSON. On macOS you can keep the credential out of them entirely:

```bash
security add-generic-password -s canvas-student-mcp -a cookie -w 'canvas_session=PASTE_VALUE_HERE' -U
```

Use `-a token` instead of `-a cookie` for an API token. The server checks environment variables first, then the Keychain, so this is opt-in and nothing breaks if you skip it. `CANVAS_NO_KEYCHAIN=1` disables the lookup.

### Register with Claude

**Claude Code** — with the credential in the Keychain, the config holds no secret at all:

```bash
claude mcp add canvas --scope user \
  --env CANVAS_BASE_URL=https://yourschool.instructure.com \
  -- npx -y canvas-student-mcp
```

Passing the credential inline instead of using the Keychain:

```bash
claude mcp add canvas --scope user \
  --env 'CANVAS_COOKIE=canvas_session=PASTE_VALUE_HERE' \
  --env CANVAS_BASE_URL=https://yourschool.instructure.com \
  -- npx -y canvas-student-mcp
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "canvas": {
      "command": "node",
      "args": ["/absolute/path/to/canvas-student-mcp/dist/index.js"],
      "env": {
        "CANVAS_COOKIE": "canvas_session=PASTE_VALUE_HERE",
        "CANVAS_BASE_URL": "https://yourschool.instructure.com"
      }
    }
  }
}
```

Use `CANVAS_API_TOKEN` instead of `CANVAS_COOKIE` for token auth (token wins if both are set). Verify with: *"check my Canvas profile."*

When the cookie expires (your browser session ends), every tool tells you plainly — re-copy and update the config. With "stay signed in" checked, sessions typically last weeks.

## Agent skills

Three packaged workflows ship in [`skills/`](skills/). Copy any of them into `~/.claude/skills/` (or your project's `.claude/skills/`) and Claude will use them automatically when the request fits:

| Skill | What it does |
|---|---|
| `canvas-morning-check` | Daily briefing: what's due, new announcements, unread messages, new grades |
| `canvas-week-plan` | Reads the actual assignments and builds a day-by-day plan for the week |
| `canvas-grade-check` | Grade standing plus what-if answers, with the caveats carried through |

```bash
cp -R skills/canvas-morning-check ~/.claude/skills/
```

## Things to ask once connected

- *"What's due in the next two weeks across all my classes?"*
- *"What's my current grade in each course, and which assignments am I missing?"*
- *"Summarize this week's announcements from all my courses."*
- *"Export my BIOL 1710 course and archive it into my Notion School folder."* (with a Notion connector)
- *"Read the Week 3 page in my history course and quiz me on it."*

## Architecture notes

- **stdio transport**, stateless — one process per client session, no ports, no telemetry, no storage. Data flows Canvas → this process → your MCP client, nowhere else.
- **Auto-pagination** follows Canvas `Link: rel="next"` headers, capped at 5 pages × 100 items with explicit truncation notices so agent context stays bounded.
- **HTML → text conversion** for syllabi, descriptions, announcements, and pages — structural tags become line breaks/bullets, links become `text (url)`.
- **Zod input schemas** on every tool; MCP annotations (`readOnlyHint`) declared throughout.

## Development

```bash
npm run build   # strict TypeScript compile
npm test        # smoke test: MCP handshake, all 30 tools register, error paths
```

The smoke test runs entirely offline — CI needs no Canvas account, and it sets `CANVAS_NO_KEYCHAIN=1` so a real stored credential can't leak into a test run.

### Releasing

Publishing runs from CI ([`.github/workflows/release.yml`](.github/workflows/release.yml)), so no one publishes from a laptop:

```bash
npm version minor && git push --follow-tags
```

Pushing the tag triggers a build, the full test suite, a package-contents inspection, and a guard that the tag matches `package.json` — then publishes with [provenance](https://docs.npmjs.com/generating-provenance-statements), which cryptographically links the published tarball to the commit and workflow that built it. Running the workflow manually from the Actions tab does everything except publish, as a dry run.

## Security model

- Read-only: every Canvas call is a GET; no tool can write to Canvas. Even reading your inbox leaves messages unread.
- Credentials live in your MCP client's env config or the macOS Keychain — never on disk in this repo, never transmitted anywhere but your school's Canvas domain. File downloads follow redirects manually so credentials are never forwarded to a CDN.
- Rotate at will: log out of Canvas (or revoke the token) and the credential is dead everywhere.
- `canvas_auth_status` tells you which credential is in use, where it's stored, and whether it still works.

## License

[MIT](LICENSE)
