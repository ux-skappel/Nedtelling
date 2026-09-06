/** Coach state management tools. Persistent user goals, preferences, notes. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToolInputError } from "../../errors.js";
import { guarded, jsonResult } from "../result.js";
import {
  createEmptyCoachState,
  validateCoachState,
  updateGoal,
  addNote,
  updatePreferences,
  type CoachState,
  type TrainingGoal,
} from "../../coach/state.js";

// Placeholder for coach state storage (would be backed by environment variable, Supabase, etc.)
let coachStateStorage: CoachState | null = null;

async function getStoredCoachState(): Promise<CoachState> {
  if (coachStateStorage) return coachStateStorage;
  // TODO: Load from persistent storage (Supabase, environment, etc.)
  return createEmptyCoachState();
}

async function saveCoachState(state: CoachState): Promise<void> {
  coachStateStorage = state;
  // TODO: Persist to storage (Supabase, environment, etc.)
}

export function registerCoachTools(server: McpServer): void {
  server.registerTool(
    "garmin_get_coach_state",
    {
      title: "Get coach state",
      description:
        "Retrieve athlete goals, training phase, preferences, and coach notes. " +
        "Use this at the start of a coaching conversation to understand context without fetching Garmin history.",
      inputSchema: {},
    },
    guarded(async () => {
      const state = await getStoredCoachState();
      return jsonResult({
        source: { endpoint: "coach/state" },
        data: state,
      });
    }),
  );

  server.registerTool(
    "garmin_update_coach_state_goal",
    {
      title: "Update training goal",
      description:
        "Set or update a training goal. Example: 10K race on 2027-05-15 with target time 39:00.",
      inputSchema: {
        goalId: z
          .string()
          .describe("Unique goal identifier, e.g. 'goal_10k_2027'"),
        event: z
          .string()
          .describe("Event name, e.g. 'City 10K Race'"),
        targetTimeSec: z
          .number()
          .int()
          .positive()
          .describe("Goal time in seconds, e.g. 2340 for 39:00"),
        targetDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Target date in YYYY-MM-DD format"),
        status: z
          .enum(["active", "achieved", "archived"])
          .default("active")
          .describe("Goal status"),
      },
    },
    guarded(async (args) => {
      const state = await getStoredCoachState();

      const goal: TrainingGoal = {
        id: args.goalId,
        event: args.event,
        targetTimeSec: args.targetTimeSec,
        targetDate: args.targetDate,
        status: args.status,
      };

      const updated = updateGoal(state, goal);
      await saveCoachState(updated);

      return jsonResult({
        source: { endpoint: "coach/state" },
        data: {
          message: "Goal updated",
          goal,
        },
      });
    }),
  );

  server.registerTool(
    "garmin_update_coach_preferences",
    {
      title: "Update coaching preferences",
      description:
        "Set training preferences: long run day, quality sessions per week, max weekly mileage, etc.",
      inputSchema: {
        longRunDay: z
          .enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"])
          .optional()
          .describe("Preferred day for long runs"),
        qualitySessionsPerWeek: z
          .number()
          .int()
          .min(1)
          .max(3)
          .optional()
          .describe("Target number of quality (intensity) sessions per week"),
        maxWeeklyMileage: z
          .number()
          .positive()
          .optional()
          .describe("Maximum weekly distance in km"),
        restDaysPerWeek: z
          .number()
          .int()
          .min(1)
          .max(3)
          .optional()
          .describe("Minimum rest/recovery days per week"),
      },
    },
    guarded(async (args) => {
      const state = await getStoredCoachState();

      const prefs = {
        longRunDay: args.longRunDay,
        qualitySessionsPerWeek: args.qualitySessionsPerWeek,
        maxWeeklyMileage: args.maxWeeklyMileage,
        restDaysPerWeek: args.restDaysPerWeek,
      };

      const updated = updatePreferences(state, prefs);
      await saveCoachState(updated);

      return jsonResult({
        source: { endpoint: "coach/state" },
        data: {
          message: "Preferences updated",
          preferences: updated.preferences,
        },
      });
    }),
  );

  server.registerTool(
    "garmin_add_coach_note",
    {
      title: "Add coach note",
      description:
        "Add a coaching observation or note (max 500 characters). " +
        "Example: 'Athlete reported knee soreness, reduce intensity this week'",
      inputSchema: {
        note: z
          .string()
          .max(500)
          .describe("Coaching note"),
      },
    },
    guarded(async (args) => {
      const state = await getStoredCoachState();

      try {
        const updated = addNote(state, args.note);
        await saveCoachState(updated);

        return jsonResult({
          source: { endpoint: "coach/state" },
          data: {
            message: "Note added",
            note: args.note,
            totalNotes: updated.notes.length,
          },
        });
      } catch (e) {
        throw new ToolInputError(`Failed to add note: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
  );

  server.registerTool(
    "garmin_set_training_phase",
    {
      title: "Set training phase",
      description:
        "Set current training phase: base (build aerobic), build (increase intensity), peak (race prep), taper (reduce), or recovery.",
      inputSchema: {
        phase: z
          .enum(["base", "build", "peak", "taper", "recovery"])
          .describe("Current training phase"),
      },
    },
    guarded(async (args) => {
      const state = await getStoredCoachState();

      const updated = {
        ...state,
        currentPhase: args.phase as "base" | "build" | "peak" | "taper" | "recovery",
        updatedAt: new Date().toISOString(),
      };

      await saveCoachState(updated);

      return jsonResult({
        source: { endpoint: "coach/state" },
        data: {
          message: `Training phase set to ${args.phase}`,
          phase: args.phase,
        },
      });
    }),
  );
}
