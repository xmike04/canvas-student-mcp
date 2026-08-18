#!/usr/bin/env node
/**
 * Smoke test: boots the compiled server over stdio and verifies the MCP
 * handshake, tool registration, and credential error handling.
 * Runs without a Canvas account — no network calls are made.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const EXPECTED_TOOL_COUNT = 29;

const server = spawn("node", ["dist/index.js"], {
  env: {
    ...process.env,
    CANVAS_API_TOKEN: "",
    CANVAS_COOKIE: "",
    CANVAS_BASE_URL: "https://school.example.instructure.com",
  },
  stdio: ["pipe", "pipe", "ignore"],
});

const send = (msg) => server.stdin.write(JSON.stringify(msg) + "\n");

function fail(reason) {
  console.error(`FAIL: ${reason}`);
  server.kill();
  process.exit(1);
}

const timeout = setTimeout(() => fail("timed out after 10s"), 10_000);

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0" },
  },
});

const rl = createInterface({ input: server.stdout });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.id === 1) {
    if (!msg.result?.serverInfo?.name) fail("initialize returned no serverInfo");
    console.log(`ok: initialize (${msg.result.serverInfo.name} v${msg.result.serverInfo.version})`);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  }

  if (msg.id === 2) {
    const tools = msg.result?.tools ?? [];
    if (tools.length !== EXPECTED_TOOL_COUNT) {
      fail(`expected ${EXPECTED_TOOL_COUNT} tools, got ${tools.length}`);
    }
    for (const t of tools) {
      if (!t.name.startsWith("canvas_")) fail(`tool ${t.name} missing canvas_ prefix`);
      if (!t.description) fail(`tool ${t.name} has no description`);
    }
    console.log(`ok: tools/list (${tools.length} tools, all prefixed and described)`);
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "canvas_get_profile", arguments: {} },
    });
  }

  if (msg.id === 3) {
    const result = msg.result;
    if (!result?.isError) fail("expected isError for call without credentials");
    const text = result.content?.[0]?.text ?? "";
    if (!/credentials/i.test(text)) fail(`error message not actionable: ${text.slice(0, 120)}`);
    console.log("ok: credential-less call returns actionable error (no crash)");
    clearTimeout(timeout);
    server.kill();
    console.log("PASS");
    process.exit(0);
  }
});

server.on("exit", (code) => {
  if (code !== null && code !== 0) fail(`server exited early with code ${code}`);
});
