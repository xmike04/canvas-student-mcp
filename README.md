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
- **Expiry-aware errors** — every failure mode explains the fix in the error message itself

Design principles that differentiate it beyond auth:

- **Read-only by design.** Every tool is a GET. The server physically cannot submit assignments, post discussions, or modify anything — safe to hand to an autonomous agent.
- **Context-efficient responses.** Canvas API payloads are enormous; every tool trims to the fields an LLM actually needs, converts HTML to clean text (preserving link URLs), and caps pagination with explicit truncation notices.
- **Small and auditable.** ~600 lines of strict TypeScript, two runtime dependencies (the MCP SDK and zod). You can read the whole thing before trusting it with your school account.

Token auth is still supported if your school allows it — the cookie is the fallback, not the only path.

## Tools (19)

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
| `canvas_export_course` | One-shot markdown export of an entire course — built for Notion archiving |

## Quick start

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

### Register with Claude

**Claude Code:**

```bash
claude mcp add canvas --scope user \
  --env 'CANVAS_COOKIE=canvas_session=PASTE_VALUE_HERE' \
  --env CANVAS_BASE_URL=https://yourschool.instructure.com \
  -- node /absolute/path/to/canvas-student-mcp/dist/index.js
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
npm test        # smoke test: MCP handshake, all 19 tools register, error paths
```

The smoke test runs entirely offline — CI needs no Canvas account.

## Security model

- Read-only: every Canvas call is a GET; no tool can write to Canvas.
- Credentials live only in your MCP client's env config — never on disk in this repo, never transmitted anywhere but your school's Canvas domain.
- Rotate at will: log out of Canvas (or revoke the token) and the credential is dead everywhere.

## License

[MIT](LICENSE)
