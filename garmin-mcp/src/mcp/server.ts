/** Assembles the MCP server and its tool set. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerActivityTools } from "./tools/activities.js";
import { registerFileTools } from "./tools/files.js";
import { registerProfileTools } from "./tools/profile.js";
import { registerRawTools } from "./tools/raw.js";
import { registerStreamTools } from "./tools/streams.js";
import { registerTrainingTools } from "./tools/training.js";
import { registerWellnessTools } from "./tools/wellness.js";

export const SERVER_NAME = "garmin-mcp";
export const SERVER_VERSION = "0.1.0";

const INSTRUCTIONS = `Read-only access to one Garmin Connect account. Coaching-first design: ask aggregate
questions first, drill down only when you need details.

COACHING-FOCUSED TOOLS (start here for running questions):
- garmin_get_training_snapshot: Quick overview of last 1, 4, 12, and 52 weeks.
  Returns distance, pace, HR, training load, recovery score, anomalies, trends.
  Use for questions like: "How's my training going?" "Am I overtraining?"
- garmin_get_weekly_training_history: 4, 12, 52-week trend analysis by week.
- garmin_get_recent_activities: Recent activity summaries (no raw samples).
- garmin_get_activity_summary: Full summary of one activity without samples.
- garmin_get_activity_laps: Lap/split breakdown within an activity.

PROGRESSIVE RETRIEVAL (drill down as needed):
1. Start with garmin_get_training_snapshot or garmin_get_weekly_training_history
   for big-picture questions (trend, anomalies, periodization).
2. Use garmin_get_recent_activities or garmin_get_activity_summary to identify
   specific workouts worth analyzing.
3. Use garmin_get_activity_laps to understand the workout's structure.
4. Use garmin_get_activity_details only for per-sample analysis (HR curve,
   pace distribution, gps map, etc.). Always call with includeSamples=false
   first to see channel count and sample count.

RAW DATA TOOLS (use sparingly):
- garmin_list_activities: Browse activities by date/type. Paged.
- garmin_get_activity_details: Per-sample time series (heart rate, pace, etc.).
  Sample series are paged; follow page.nextOffset while page.hasMore is true.
- garmin_get_heart_rate_series, garmin_get_gps_track: Projections onto specific
  channels (HR vs time, position map).

OTHER TOOLS:
- Daily wellness (sleep, heart rate, stress, hrv, etc.) — call without 'series'
  first to see what channels a day holds, then name the series.
- Times are Garmin's: GMT = UTC, Local = account time zone (garmin_get_profile).
- garmin_get_raw: Connect API endpoints not covered by dedicated tools.`;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  registerProfileTools(server);
  registerTrainingTools(server);
  registerActivityTools(server);
  registerStreamTools(server);
  registerFileTools(server);
  registerWellnessTools(server);
  registerRawTools(server);

  return server;
}
