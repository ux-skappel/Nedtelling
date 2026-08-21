/**
 * Vercel entry point: MCP over Streamable HTTP.
 *
 * Every request builds its own server and transport and throws both away
 * afterwards. That statelessness is what makes the server safe to run on
 * serverless functions with no database behind them — any instance can answer
 * any request, and nothing needs to survive between them.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { timingSafeEqual } from "node:crypto";
import { ConfigError, getConfig } from "../src/config.js";
import { createServer } from "../src/mcp/server.js";

const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_INTERNAL_ERROR = -32603;

function jsonRpcError(response: VercelResponse, status: number, code: number, message: string): void {
  response.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

/** Constant-time comparison that tolerates length differences. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function presentedToken(request: VercelRequest): string | null {
  const authorization = request.headers.authorization;
  if (typeof authorization === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1]) return match[1].trim();
  }
  const header = request.headers["x-mcp-token"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return null;
}

function applyCors(request: VercelRequest, response: VercelResponse): void {
  const origin = request.headers.origin;
  response.setHeader("Access-Control-Allow-Origin", typeof origin === "string" ? origin : "*");
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-Mcp-Token, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  );
  response.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, Mcp-Protocol-Version");
  response.setHeader("Access-Control-Max-Age", "86400");
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  let config;
  try {
    config = getConfig();
  } catch (error) {
    const message =
      error instanceof ConfigError ? error.message : "Server is not configured correctly.";
    jsonRpcError(response, 500, JSONRPC_INTERNAL_ERROR, message);
    return;
  }

  const token = presentedToken(request);
  if (!token || !secretsMatch(token, config.mcpAuthToken)) {
    response.setHeader("WWW-Authenticate", 'Bearer realm="garmin-mcp"');
    jsonRpcError(response, 401, JSONRPC_INVALID_REQUEST, "Missing or invalid bearer token.");
    return;
  }

  if (request.method !== "POST") {
    // Stateless mode has no server-initiated stream to attach to.
    response.setHeader("Allow", "POST, OPTIONS");
    jsonRpcError(response, 405, JSONRPC_INVALID_REQUEST, "This endpoint only accepts POST.");
    return;
  }

  // The SDK requires both media types on POST; some clients send only JSON.
  const accept = request.headers.accept ?? "";
  if (!accept.includes("text/event-stream") || !accept.includes("application/json")) {
    request.headers.accept = "application/json, text/event-stream";
  }

  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  response.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  } catch (error) {
    console.error("MCP request failed:", error);
    if (!response.headersSent) {
      jsonRpcError(response, 500, JSONRPC_INTERNAL_ERROR, "Internal server error.");
    }
  }
}
