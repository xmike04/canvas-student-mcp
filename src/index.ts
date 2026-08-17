#!/usr/bin/env node
/**
 * Canvas MCP server — brings live UNT Canvas data (courses, assignments, grades,
 * announcements, modules, pages, files, discussions, quizzes, to-dos) into Claude.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { canvasGet, canvasGetPaginated, baseUrl } from "./canvas.js";
import { htmlToText } from "./html.js";

const server = new McpServer({
  name: "canvas-student-mcp",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function jsonResult(data: unknown, note?: string): ToolResult {
  const text = JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text: note ? `${note}\n${text}` : text }] };
}

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/** Wrap a handler so API failures come back as readable tool errors. */
function safe<A>(fn: (args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      };
    }
  };
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

function truncNote(truncated: boolean, what: string): string | undefined {
  return truncated
    ? `NOTE: result capped at 500 ${what}; narrow the query (course, dates, search) for the rest.`
    : undefined;
}

// --- slimming helpers: return only fields an assistant actually needs -------

function slimCourse(c: any) {
  return {
    id: c.id,
    name: c.name,
    course_code: c.course_code,
    term: c.term?.name,
    start_at: c.start_at,
    end_at: c.end_at,
    workflow_state: c.workflow_state,
    current_score: c.enrollments?.[0]?.computed_current_score ?? null,
    current_grade: c.enrollments?.[0]?.computed_current_grade ?? null,
  };
}

function slimSubmission(s: any) {
  if (!s) return null;
  return {
    workflow_state: s.workflow_state,
    submitted_at: s.submitted_at,
    score: s.score,
    grade: s.grade,
    late: s.late,
    missing: s.missing,
    excused: s.excused,
  };
}

function slimAssignment(a: any, includeDescription = false) {
  return {
    id: a.id,
    name: a.name,
    due_at: a.due_at,
    unlock_at: a.unlock_at,
    lock_at: a.lock_at,
    points_possible: a.points_possible,
    submission_types: a.submission_types,
    has_submitted: a.has_submitted_submissions,
    html_url: a.html_url,
    ...(includeDescription ? { description: htmlToText(a.description, 3000) } : {}),
    submission: slimSubmission(a.submission),
  };
}

/** Context codes (course_123) for the user's active courses. */
async function activeCourseContextCodes(): Promise<{ codes: string[]; names: Record<string, string> }> {
  const { items } = await canvasGetPaginated("/courses", {
    enrollment_state: "active",
    "state[]": ["available"],
  });
  const names: Record<string, string> = {};
  const codes = items.map((c: any) => {
    names[`course_${c.id}`] = c.name;
    return `course_${c.id}`;
  });
  return { codes, names };
}

// ---------------------------------------------------------------------------
// Identity / sanity check
// ---------------------------------------------------------------------------

server.registerTool(
  "canvas_get_profile",
  {
    title: "Get my Canvas profile",
    description:
      "Fetch the authenticated user's Canvas profile (name, primary email, id). Use this to verify the API token works.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  safe(async () => {
    const p = await canvasGet("/users/self/profile");
    return jsonResult({ id: p.id, name: p.name, primary_email: p.primary_email, login_id: p.login_id, canvas: baseUrl() });
  })
);

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

server.registerTool(
  "canvas_list_courses",
  {
    title: "List my courses",
    description:
      "List the user's Canvas courses with current score/grade per course. state='active' (default) for this semester, 'completed' for past courses, 'all' for everything.",
    inputSchema: {
      state: z.enum(["active", "completed", "all"]).optional().describe("Enrollment state filter; default 'active'"),
    },
    annotations: READ_ONLY,
  },
  safe(async ({ state }) => {
    const params: Record<string, any> = {
      "include[]": ["term", "total_scores"],
    };
    if (state !== "all") params.enrollment_state = state ?? "active";
    const { items, truncated } = await canvasGetPaginated("/courses", params);
    return jsonResult(items.map(slimCourse), truncNote(truncated, "courses"));
  })
);

server.registerTool(
  "canvas_get_course",
  {
    title: "Get course details + syllabus",
    description:
      "Get one course's details including the full syllabus text, term, and current score. course_id comes from canvas_list_courses.",
    inputSchema: {
      course_id: z.number().describe("Canvas course ID"),
    },
    annotations: READ_ONLY,
  },
  safe(async ({ course_id }) => {
    const c = await canvasGet(`/courses/${course_id}`, {
      "include[]": ["syllabus_body", "term", "total_scores", "teachers"],
    });
    return jsonResult({
      ...slimCourse(c),
      teachers: (c.teachers ?? []).map((t: any) => t.display_name),
      syllabus: htmlToText(c.syllabus_body, 30000) || "(no syllabus posted)",
    });
  })
);

// ---------------------------------------------------------------------------
// Assignments & grades
// ---------------------------------------------------------------------------

server.registerTool(
  "canvas_list_assignments",
  {
    title: "List assignments",
    description:
      "List a course's assignments ordered by due date, each with the user's submission status (submitted/score/late/missing). " +
      "Optional bucket filters: upcoming, past, overdue, undated, ungraded, unsubmitted, future.",
    inputSchema: {
      course_id: z.number().describe("Canvas course ID"),
      bucket: z
        .enum(["upcoming", "past", "overdue", "undated", "ungraded", "unsubmitted", "future"])
        .optional()
        .describe("Filter assignments by due-date/submission bucket"),
    },
    annotations: READ_ONLY,
  },
  safe(async ({ course_id, bucket }) => {
    const { items, truncated } = await canvasGetPaginated(`/courses/${course_id}/assignments`, {
      "include[]": ["submission"],
      order_by: "due_at",
      bucket,
    });
    return jsonResult(items.map((a: any) => slimAssignment(a)), truncNote(truncated, "assignments"));
  })
);

server.registerTool(
  "canvas_get_assignment",
  {
    title: "Get assignment details",
    description:
      "Get one assignment's full details: description (as text), due/lock dates, rubric, and the user's submission with score and grade.",
    inputSchema: {
      course_id: z.number().describe("Canvas course ID"),
      assignment_id: z.number().describe("Canvas assignment ID"),
    },
    annotations: READ_ONLY,
  },
  safe(async ({ course_id, assignment_id }) => {
    const a = await canvasGet(`/courses/${course_id}/assignments/${assignment_id}`, {
      "include[]": ["submission"],
    });
    const rubric = (a.rubric ?? []).map((r: any) => ({
      criterion: r.description,
      points: r.points,
    }));
    return jsonResult({
      ...slimAssignment(a, true),
      ...(rubric.length ? { rubric } : {}),
    });
  })
);

server.registerTool(
  "canvas_get_grades",
  {
    title: "Get grades",
    description:
      "Without course_id: current score/grade for every active course. With course_id: every graded submission in that course " +
      "(assignment name, score, points possible, late/missing flags) — useful for 'what's my grade breakdown'.",
    inputSchema: {
      course_id: z.number().optional().describe("Canvas course ID; omit for all-course overview"),
    },
    annotations: READ_ONLY,
  },
  safe(async ({ course_id }) => {
    if (course_id === undefined) {
      const { items } = await canvasGetPaginated("/courses", {
        enrollment_state: "active",
        "include[]": ["total_scores", "term"],
      });
      return jsonResult(
        items.map((c: any) => ({
          course_id: c.id,
          course: c.name,
          term: c.term?.name,
          current_score: c.enrollments?.[0]?.computed_current_score ?? null,
          current_grade: c.enrollments?.[0]?.computed_current_grade ?? null,
          final_score: c.enrollments?.[0]?.computed_final_score ?? null,
        }))
      );
    }
    const { items, truncated } = await canvasGetPaginated(
      `/courses/${course_id}/students/submissions`,
      {
        "student_ids[]": ["self"],
        "include[]": ["assignment"],
      }
    );
    const rows = items.map((s: any) => ({
      assignment_id: s.assignment_id,
      assignment: s.assignment?.name,
      due_at: s.assignment?.due_at,
      points_possible: s.assignment?.points_possible,
      score: s.score,
      grade: s.grade,
      workflow_state: s.workflow_state,
      late: s.late,
      missing: s.missing,
      excused: s.excused,
    }));
    return jsonResult(rows, truncNote(truncated, "submissions"));
  })
);

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

server.registerTool(
  "canvas_list_announcements",
  {
    title: "List announcements",
    description:
      "List announcements. Defaults to all active courses over the last 30 days; pass course_id and/or start_date (ISO) to narrow or widen.",
    inputSchema: {
      course_id: z.number().optional().describe("Limit to one course"),
      start_date: z.string().optional().describe("ISO date (YYYY-MM-DD); default 30 days ago"),
      end_date: z.string().optional().describe("ISO date (YYYY-MM-DD); default today"),
    },
    annotations: READ_ONLY,
  },
  safe(async ({ course_id, start_date, end_date }) => {
    let codes: string[];
    let names: Record<string, string> = {};
    if (course_id !== undefined) {
      codes = [`course_${course_id}`];
    } else {
      ({ codes, names } = await activeCourseContextCodes());
    }
    if (codes.length === 0) return textResult("No active courses found.");

    const { items, truncated } = await canvasGetPaginated("/announcements", {
      "context_codes[]": codes,
      start_date: start_date ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10),
      end_date: end_date ?? new Date(Date.now() + 86400_000).toISOString().slice(0, 10),
    });
    const rows = items.map((a: any) => ({
      id: a.id,
      course: names[a.context_code] ?? a.context_code,
      title: a.title,
      posted_at: a.posted_at,
      author: a.user_name ?? a.author?.display_name,
      message: htmlToText(a.message, 2000),
    }));
    return jsonResult(rows, truncNote(truncated, "announcements"));
  })
);

// ---------------------------------------------------------------------------
// Modules & pages
// ---------------------------------------------------------------------------

server.registerTool(
  "canvas_list_modules",
  {
    title: "List modules",
    description:
      "List a course's modules with their items (pages, files, assignments, quizzes, links) in order — the course's content outline.",
    inputSchema: {
      course_id: z.number().describe("Canvas course ID"),
    },
    annotations: READ_ONLY,
  },
  safe(async ({ course_id }) => {
    const { items, truncated } = await canvasGetPaginated(`/courses/${course_id}/modules`, {
      "include[]": ["items"],
    });
    const rows = items.map((m: any) => ({
      id: m.id,
      name: m.name,
      state: m.state,
      items: (m.items ?? []).map((i: any) => ({
        type: i.type,
        title: i.title,
        // content_id for Files/Assignments/Quizzes; page_url for Pages
        content_id: i.content_id,
        page_url: i.page_url,
        html_url: i.html_url,
      })),
    }));
    return jsonResult(rows, truncNote(truncated, "modules"));
  })
);

server.registerTool(
  "canvas_list_pages",
  {
    title: "List course pages",
    description: "List a course's wiki pages. Use search_term to filter by title.",
    inputSchema: {
      course_id: z.number().describe("Canvas course ID"),
      search_term: z.string().optional().describe("Filter pages by title"),
    },
    annotations: READ_ONLY,
  },
  safe(async ({ course_id, search_term }) => {
    const { items, truncated } = await canvasGetPaginated(`/courses/${course_id}/pages`, {
      search_term,
      sort: "title",
    });
    const rows = items.map((p: any) => ({
      page_id: p.page_id,
      url: p.url,
      title: p.title,
      updated_at: p.updated_at,
    }));
    return jsonResult(rows, truncNote(truncated, "pages"));
  })
);

server.registerTool(
  "canvas_get_page",
  {
    title: "Read a course page",
    description:
      "Read one course page's full content as text. page_url is the 'url' slug from canvas_list_pages or canvas_list_modules.",
    inputSchema: {
      course_id: z.number().describe("Canvas course ID"),
      page_url: z.string().describe("Page URL slug (e.g. 'week-1-overview') or page ID"),
    },
    annotations: READ_ONLY,
  },
  safe(async ({ course_id, page_url }) => {
    const p = await canvasGet(`/courses/${course_id}/pages/${encodeURIComponent(page_url)}`);
    return jsonResult({
      title: p.title,
      updated_at: p.updated_at,
      body: htmlToText(p.body, 15000),
    });
  })
);

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

server.registerTool(
  "canvas_list_files",
  {
    title: "List course files",
    description:
      "List files in a course (slides, PDFs, handouts). Use search_term to filter by name. Returns file IDs for canvas_get_file_link.",
    inputSchema: {
      course_id: z.number().describe("Canvas course ID"),
      search_term: z.string().optional().describe("Filter files by name"),
    },
    annotations: READ_ONLY,
  },
  safe(async ({ course_id, search_term }) => {
    const { items, truncated } = await canvasGetPaginated(`/courses/${course_id}/files`, {
      search_term,
      sort: "updated_at",
      order: "desc",
    });
    const rows = items.map((f: any) => ({
      id: f.id,
      filename: f.display_name,
      content_type: f["content-type"],
      size_kb: Math.round((f.size ?? 0) / 1024),
      updated_at: f.updated_at,
    }));
    return jsonResult(rows, truncNote(truncated, "files"));
  })
);

server.registerTool(
  "canvas_get_file_link",
  {
    title: "Get file download link",
    description:
      "Get a temporary authenticated download URL for a file (file_id from canvas_list_files or module items). The URL expires, so use it promptly.",
    inputSchema: {
      file_id: z.number().describe("Canvas file ID"),
    },
    annotations: READ_ONLY,
  },
  safe(async ({ file_id }) => {
    const f = await canvasGet(`/files/${file_id}`);
    return jsonResult({
      filename: f.display_name,
      content_type: f["content-type"],
      size_kb: Math.round((f.size ?? 0) / 1024),
      download_url: f.url,
      note: "URL is time-limited; download promptly.",
    });
  })
);

// ---------------------------------------------------------------------------
// Discussions & quizzes
// ---------------------------------------------------------------------------

server.registerTool(
  "canvas_list_discussions",
  {
    title: "List discussions",
    description: "List a course's discussion topics with unread counts and due dates.",
    inputSchema: {
      course_id: z.number().describe("Canvas course ID"),
    },
    annotations: READ_ONLY,
  },
  safe(async ({ course_id }) => {
    const { items, truncated } = await canvasGetPaginated(
      `/courses/${course_id}/discussion_topics`,
      { order_by: "recent_activity" }
    );
    const rows = items.map((d: any) => ({
      id: d.id,
      title: d.title,
      posted_at: d.posted_at,
      due_at: d.assignment?.due_at ?? d.lock_at,
      unread_count: d.unread_count,
      reply_count: d.discussion_subentry_count,
      message: htmlToText(d.message, 1000),
    }));
    return jsonResult(rows, truncNote(truncated, "discussions"));
  })
);

server.registerTool(
  "canvas_get_discussion",
  {
    title: "Read a discussion thread",
    description: "Read a discussion topic's full thread, including replies.",
    inputSchema: {
      course_id: z.number().describe("Canvas course ID"),
      topic_id: z.number().describe("Discussion topic ID from canvas_list_discussions"),
    },
    annotations: READ_ONLY,
  },
  safe(async ({ course_id, topic_id }) => {
    const view = await canvasGet(`/courses/${course_id}/discussion_topics/${topic_id}/view`);
    const participants: Record<number, string> = {};
    for (const p of view.participants ?? []) participants[p.id] = p.display_name;

    const flatten = (entries: any[]): any[] =>
      (entries ?? []).flatMap((e: any) => [
        {
          author: participants[e.user_id] ?? `user ${e.user_id}`,
          posted_at: e.created_at,
          message: htmlToText(e.message, 1500),
        },
        ...flatten(e.replies ?? []),
      ]);

    return jsonResult(flatten(view.view ?? []));
  })
);

server.registerTool(
  "canvas_list_quizzes",
  {
    title: "List quizzes",
    description: "List a course's quizzes with due dates, time limits, allowed attempts, and points.",
    inputSchema: {
      course_id: z.number().describe("Canvas course ID"),
    },
    annotations: READ_ONLY,
  },
  safe(async ({ course_id }) => {
    const { items, truncated } = await canvasGetPaginated(`/courses/${course_id}/quizzes`);
    const rows = items.map((q: any) => ({
      id: q.id,
      title: q.title,
      due_at: q.due_at,
      unlock_at: q.unlock_at,
      lock_at: q.lock_at,
      time_limit_minutes: q.time_limit,
      allowed_attempts: q.allowed_attempts,
      points_possible: q.points_possible,
      question_count: q.question_count,
      html_url: q.html_url,
    }));
    return jsonResult(rows, truncNote(truncated, "quizzes"));
  })
);

// ---------------------------------------------------------------------------
// Planner: to-do, upcoming, calendar
// ---------------------------------------------------------------------------

server.registerTool(
  "canvas_list_todo",
  {
    title: "My to-do list",
    description: "The user's Canvas to-do list: assignments and quizzes needing submission, across all courses.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  safe(async () => {
    const { items } = await canvasGetPaginated("/users/self/todo");
    const rows = items.map((t: any) => ({
      type: t.type,
      course_id: t.course_id,
      assignment: t.assignment?.name ?? t.quiz?.title,
      due_at: t.assignment?.due_at ?? t.quiz?.due_at,
      points_possible: t.assignment?.points_possible ?? t.quiz?.points_possible,
      html_url: t.html_url,
    }));
    return jsonResult(rows);
  })
);

server.registerTool(
  "canvas_list_upcoming",
  {
    title: "Upcoming events",
    description: "The user's upcoming Canvas events and assignment due dates across all courses (next ~2 weeks).",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  safe(async () => {
    const items = await canvasGet("/users/self/upcoming_events");
    const rows = (items as any[]).map((e: any) => ({
      title: e.title,
      type: e.assignment ? "assignment" : "event",
      start_at: e.start_at ?? e.assignment?.due_at,
      context: e.context_name,
      html_url: e.html_url,
    }));
    return jsonResult(rows);
  })
);

server.registerTool(
  "canvas_list_calendar_events",
  {
    title: "Calendar events",
    description:
      "Calendar events (lectures, office hours, deadlines) between two dates. type='assignment' shows assignment due dates instead of plain events.",
    inputSchema: {
      start_date: z.string().describe("ISO date YYYY-MM-DD"),
      end_date: z.string().describe("ISO date YYYY-MM-DD"),
      course_id: z.number().optional().describe("Limit to one course; default all active courses"),
      type: z.enum(["event", "assignment"]).optional().describe("Default 'event'"),
    },
    annotations: READ_ONLY,
  },
  safe(async ({ start_date, end_date, course_id, type }) => {
    let codes: string[];
    let names: Record<string, string> = {};
    if (course_id !== undefined) {
      codes = [`course_${course_id}`];
    } else {
      ({ codes, names } = await activeCourseContextCodes());
    }
    const { items, truncated } = await canvasGetPaginated("/calendar_events", {
      type: type ?? "event",
      start_date,
      end_date,
      "context_codes[]": codes.slice(0, 10), // Canvas caps context_codes at 10
    });
    const rows = items.map((e: any) => ({
      title: e.title,
      start_at: e.start_at ?? e.assignment?.due_at,
      end_at: e.end_at,
      course: names[e.context_code] ?? e.context_name ?? e.context_code,
      location: e.location_name,
      description: htmlToText(e.description, 500),
    }));
    return jsonResult(rows, truncNote(truncated, "events"));
  })
);

// ---------------------------------------------------------------------------
// Workflow tool: full course export (Notion-ready markdown)
// ---------------------------------------------------------------------------

server.registerTool(
  "canvas_export_course",
  {
    title: "Export course to markdown",
    description:
      "One-shot export of a course as a single markdown document: details, syllabus, grade, all assignments with submission status, " +
      "module outline, and recent announcements. Designed for archiving to Notion or notes apps.",
    inputSchema: {
      course_id: z.number().describe("Canvas course ID"),
    },
    annotations: READ_ONLY,
  },
  safe(async ({ course_id }) => {
    const [course, assignments, modules, announcements] = await Promise.all([
      canvasGet(`/courses/${course_id}`, {
        "include[]": ["syllabus_body", "term", "total_scores", "teachers"],
      }),
      canvasGetPaginated(`/courses/${course_id}/assignments`, {
        "include[]": ["submission"],
        order_by: "due_at",
      }),
      canvasGetPaginated(`/courses/${course_id}/modules`, { "include[]": ["items"] }),
      canvasGetPaginated("/announcements", {
        "context_codes[]": [`course_${course_id}`],
        start_date: new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10),
      }).catch(() => ({ items: [] as any[], truncated: false })),
    ]);

    const fmtDate = (d: string | null | undefined) =>
      d ? new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";

    const lines: string[] = [];
    lines.push(`# ${course.name}`);
    lines.push("");
    lines.push(`- **Course code:** ${course.course_code ?? "—"}`);
    lines.push(`- **Term:** ${course.term?.name ?? "—"}`);
    lines.push(`- **Instructor(s):** ${(course.teachers ?? []).map((t: any) => t.display_name).join(", ") || "—"}`);
    const enr = course.enrollments?.[0];
    if (enr?.computed_current_score != null) {
      lines.push(`- **Current grade:** ${enr.computed_current_score}% (${enr.computed_current_grade ?? "—"})`);
    }
    lines.push("");

    const syllabus = htmlToText(course.syllabus_body, 30000);
    if (syllabus) {
      lines.push("## Syllabus");
      lines.push("");
      lines.push(syllabus);
      lines.push("");
    }

    lines.push("## Assignments");
    lines.push("");
    lines.push("| Assignment | Due | Points | Status | Score |");
    lines.push("|---|---|---|---|---|");
    for (const a of assignments.items) {
      const s = a.submission;
      const status = s?.missing
        ? "MISSING"
        : s?.late
          ? "late"
          : s?.workflow_state === "graded"
            ? "graded"
            : s?.submitted_at
              ? "submitted"
              : "not submitted";
      const score = s?.score != null ? `${s.score}/${a.points_possible ?? "?"}` : "—";
      lines.push(
        `| ${(a.name ?? "").replace(/\|/g, "/")} | ${fmtDate(a.due_at)} | ${a.points_possible ?? "—"} | ${status} | ${score} |`
      );
    }
    lines.push("");

    if (modules.items.length) {
      lines.push("## Modules");
      lines.push("");
      for (const m of modules.items) {
        lines.push(`### ${m.name}`);
        for (const i of m.items ?? []) {
          lines.push(`- [${i.type}] ${i.title}`);
        }
        lines.push("");
      }
    }

    if (announcements.items.length) {
      lines.push("## Recent announcements");
      lines.push("");
      for (const a of announcements.items) {
        lines.push(`### ${a.title} — ${fmtDate(a.posted_at)}`);
        lines.push("");
        lines.push(htmlToText(a.message, 2000));
        lines.push("");
      }
    }

    return textResult(lines.join("\n"));
  })
);

// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `canvas-student-mcp running (stdio) → ${process.env.CANVAS_BASE_URL ?? "(CANVAS_BASE_URL not set — tools will explain how to configure it)"}`
);
