/** Assembles the MCP server and its tool set. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerActivityTools } from "./tools/activities.js";
import { registerFileTools } from "./tools/files.js";
import { registerProfileTools } from "./tools/profile.js";
import { registerRawTools } from "./tools/raw.js";
import { registerStreamTools } from "./tools/streams.js";
import { registerWellnessTools } from "./tools/wellness.js";

export const SERVER_NAME = "garmin-mcp";
export const SERVER_VERSION = "0.1.0";

const INSTRUCTIONS = `Read-only access to one Garmin Connect account at the resolution Garmin stores.

Nothing is aggregated or rounded on the way through: tools return Garmin's own
fields, and the only reshaping is naming sample channels from Garmin's metric
descriptors and slicing long arrays into pages.

How to work with it:
- Find activities with garmin_list_activities, then use the activityId with the
  garmin_get_activity_* tools.
- Sample series are paged. Ask for a window with offset/limit and follow
  page.nextOffset while page.hasMore is true. If a page would exceed the
  response budget, the server shrinks it and says so in page.limitAdjusted.
- For a big activity, call garmin_get_activity_details with includeSamples=false
  first: it lists the channels the device recorded and how many samples there
  are, so you can request only what you need.
- Daily wellness tools (sleep, heart rate, stress, ...) hold several series per
  day. Call them without 'series' to see what a day contains, then name one.
- Times are Garmin's: GMT fields are UTC, Local fields are the account's time
  zone. garmin_get_profile reports that time zone.
- garmin_get_raw reaches Connect API endpoints the dedicated tools do not cover.`;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  registerProfileTools(server);
  registerActivityTools(server);
  registerStreamTools(server);
  registerFileTools(server);
  registerWellnessTools(server);
  registerRawTools(server);

  return server;
}
