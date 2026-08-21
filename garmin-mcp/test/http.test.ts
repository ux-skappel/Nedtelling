/**
 * Tests the Vercel entry point over real HTTP: the auth gate, the method rules,
 * and one complete JSON-RPC round trip.
 */

import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import handler from "../api/mcp.js";
import { resetConfig } from "../src/config.js";
import { resetAuthCache } from "../src/garmin/auth.js";
import { serializeTokens } from "../src/garmin/tokens.js";

const TOKEN = serializeTokens({
  oauth1: { oauth_token: "t", oauth_token_secret: "s", domain: "garmin.com" },
  oauth2: null,
});

/** The two response helpers Vercel adds on top of Node's ServerResponse. */
function decorate(response: ServerResponse): void {
  const decorated = response as ServerResponse & {
    status: (code: number) => typeof decorated;
    json: (body: unknown) => void;
  };
  decorated.status = (code: number) => {
    decorated.statusCode = code;
    return decorated;
  };
  decorated.json = (body: unknown) => {
    decorated.setHeader("Content-Type", "application/json");
    decorated.end(JSON.stringify(body));
  };
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const server = createServer((request, response) => {
  void (async () => {
    // Vercel parses the JSON body before the handler sees it.
    (request as IncomingMessage & { body?: unknown }).body = await readBody(request);
    decorate(response);
    await handler(request as never, response as never);
  })();
});

let baseUrl = "";

before(async () => {
  process.env["GARMIN_TOKEN"] = TOKEN;
  process.env["MCP_AUTH_TOKEN"] = "correct-horse-battery-staple";
  resetConfig();
  resetAuthCache();

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
};

test("a request without a token is refused", async () => {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(initialize),
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="garmin-mcp"');
});

test("a wrong token is refused, whatever its length", async () => {
  for (const token of ["wrong", "correct-horse-battery-stapl", "correct-horse-battery-staplez"]) {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(initialize),
    });
    assert.equal(response.status, 401, `token ${token} should be refused`);
  }
});

test("the right token completes a JSON-RPC handshake", async () => {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: "Bearer correct-horse-battery-staple",
    },
    body: JSON.stringify(initialize),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    result?: { serverInfo?: { name?: string }; instructions?: string };
  };
  assert.equal(body.result?.serverInfo?.name, "garmin-mcp");
  assert.match(body.result?.instructions ?? "", /page.nextOffset/);
});

test("the token may also travel in X-Mcp-Token", async () => {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Mcp-Token": "correct-horse-battery-staple" },
    body: JSON.stringify(initialize),
  });
  assert.equal(response.status, 200);
});

test("GET is refused even with a valid token", async () => {
  const response = await fetch(baseUrl, {
    headers: { Authorization: "Bearer correct-horse-battery-staple" },
  });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST, OPTIONS");
});

test("preflight is answered without a token", async () => {
  const response = await fetch(baseUrl, { method: "OPTIONS", headers: { Origin: "https://claude.ai" } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://claude.ai");
});
