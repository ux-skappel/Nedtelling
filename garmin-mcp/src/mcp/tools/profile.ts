/** Account-level tools: who the token belongs to, and how their units are set. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as api from "../../garmin/endpoints.js";
import { guarded, jsonResult } from "../result.js";

export function registerProfileTools(server: McpServer): void {
  server.registerTool(
    "garmin_get_profile",
    {
      title: "Get Garmin profile",
      description:
        "The Garmin account this server is authenticated as, and its user settings — time zone, " +
        "measurement units, heart-rate zones, and birth date. Useful for interpreting every " +
        "other response correctly.",
      inputSchema: {},
    },
    guarded(async () => {
      const [profile, settings] = await Promise.all([api.getSocialProfile(), api.getUserSettings()]);
      return jsonResult({
        source: { endpoint: "/userprofile-service/socialProfile + /userprofile/user-settings" },
        data: { profile, settings },
      });
    }),
  );
}
