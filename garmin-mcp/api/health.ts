/**
 * Unauthenticated liveness check.
 *
 * Reports whether the deployment has the environment variables it needs, so a
 * misconfigured deploy can be spotted without handing out a token. It never
 * echoes a value — only whether one is set.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SERVER_NAME, SERVER_VERSION } from "../src/mcp/server.js";

export default function handler(_request: VercelRequest, response: VercelResponse): void {
  const configured = {
    GARMIN_TOKEN: Boolean(process.env["GARMIN_TOKEN"]),
    MCP_AUTH_TOKEN: Boolean(process.env["MCP_AUTH_TOKEN"]),
  };
  const ready = Object.values(configured).every(Boolean);

  response.status(ready ? 200 : 503).json({
    status: ready ? "ok" : "misconfigured",
    server: SERVER_NAME,
    version: SERVER_VERSION,
    endpoint: "/api/mcp",
    configured,
  });
}
