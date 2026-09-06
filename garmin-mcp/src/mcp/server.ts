/** Assembles the MCP server and its tool set. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerActivityTools } from "./tools/activities.js";
import { registerFileTools } from "./tools/files.js";
import { registerCoachTools } from "./tools/coach.js";
import { registerProfileTools } from "./tools/profile.js";
import { registerRawTools } from "./tools/raw.js";
import { registerStreamTools } from "./tools/streams.js";
import { registerTrainingTools } from "./tools/training.js";
import { registerWellnessTools } from "./tools/wellness.js";

export const SERVER_NAME = "garmin-mcp";
export const SERVER_VERSION = "0.1.0";

const INSTRUCTIONS = `Read-only access to one Garmin Connect account. Running-coach-first design.

COACH STATE (start here):
- garmin_get_coach_state: Current goals, training phase, preferences, recent notes.
  Use to understand coaching context before analyzing Garmin data.

RUNNING ANALYSIS TOOLS (primary for coaching questions):
- garmin_get_training_snapshot: Last 1/4/12/52 weeks (distance, pace, HR, load, recovery, anomalies).
  Use for: "How's my training?" "Am I overtraining?" "Fitness trends?"
- garmin_get_weekly_training_history: Per-week aggregates over N weeks.
  Use for: "Show me week-by-week progression" (trends, patterns, periodization).
- garmin_get_running_progress: Comprehensive running summary (volume, efficiency, intervals, form).
  Use for: "Am I getting fitter?" "What should I focus on?"
- garmin_get_recent_activities: Recent run summaries (no samples).
  Use to identify which workouts to analyze further.

WORKOUT-LEVEL ANALYSIS:
- garmin_get_activity_summary: One activity summary without sample data.
  Use before requesting detailed analysis.
- garmin_get_activity_laps: Lap/split breakdown (intervals, pacing, HR progression).
  Use for: "What was my pace per lap?" "How did HR change through the workout?"

PROGRESSIVE RETRIEVAL (optimal Claude ordering):
1. garmin_get_coach_state (understand goals, phase, preferences)
2. garmin_get_training_snapshot or garmin_get_weekly_training_history
   (big-picture: trends, anomalies, overall fitness)
3. garmin_get_running_progress (comprehensive running-specific summary)
4. garmin_get_recent_activities (find specific workouts)
5. garmin_get_activity_summary + garmin_get_activity_laps (analyze one workout)
6. garmin_get_activity_details (only for detailed HR curves, elevation, GPS maps)

COACH STATE UPDATES (end of conversation or when context changes):
- garmin_update_coach_state_goal: Add/update race goals
- garmin_update_coach_preferences: Set training preferences
- garmin_set_training_phase: Mark current phase (base/build/peak/taper/recovery)
- garmin_add_coach_note: Record coaching observations

RAW DATA TOOLS (use sparingly, last resort):
- garmin_list_activities: Browse all activities by date/type.
- garmin_get_activity_details: Per-sample time series (heart rate, pace, samples).
  Sample series are paged; follow page.nextOffset while page.hasMore is true.
- garmin_get_heart_rate_series, garmin_get_gps_track: Channel projections.

OTHER:
- Daily wellness tools: sleep, HRV, stress, body battery.
- Times: GMT = UTC, Local = account timezone (garmin_get_profile).
- garmin_get_raw: Direct API endpoints.`;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  registerCoachTools(server);
  registerProfileTools(server);
  registerTrainingTools(server);
  registerActivityTools(server);
  registerStreamTools(server);
  registerFileTools(server);
  registerWellnessTools(server);
  registerRawTools(server);

  return server;
}
