/**
 * Lightweight coach state: non-Garmin data (goals, phases, preferences).
 * Structured, validated, suitable for serverless persistence.
 */

export interface TrainingGoal {
  id: string;
  event: string; // e.g., "10K", "Half Marathon"
  targetTimeSec: number; // race goal in seconds
  targetDate: string; // ISO date YYYY-MM-DD
  status: "active" | "achieved" | "archived";
}

export interface CoachPreferences {
  longRunDay?: "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";
  qualitySessionsPerWeek?: number; // target
  maxWeeklyMileage?: number;
  restDaysPerWeek?: number;
  preferredIntensities?: ("recovery" | "easy" | "steady" | "tempo" | "threshold" | "intervals")[];
}

export interface CoachState {
  updatedAt: string; // ISO timestamp
  goals: TrainingGoal[];
  currentPhase?: "base" | "build" | "peak" | "taper" | "recovery";
  preferences: CoachPreferences;
  constraints: string[]; // e.g., ["no running before 6am", "max 2 runs per week"]
  notes: string[]; // Recent coach notes/observations
}

/**
 * Default/empty coach state.
 */
export function createEmptyCoachState(): CoachState {
  return {
    updatedAt: new Date().toISOString(),
    goals: [],
    preferences: {},
    constraints: [],
    notes: [],
  };
}

/**
 * Validate coach state structure.
 */
export function validateCoachState(state: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!state || typeof state !== "object") {
    errors.push("Coach state must be an object");
    return { valid: false, errors };
  }

  if (typeof state.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(state.updatedAt)) {
    errors.push("updatedAt must be ISO timestamp");
  }

  if (!Array.isArray(state.goals)) {
    errors.push("goals must be array");
  } else {
    state.goals.forEach((g: any, i: number) => {
      if (!g.id || !g.event || typeof g.targetTimeSec !== "number" || !g.targetDate) {
        errors.push(`goal[${i}]: missing id, event, targetTimeSec, or targetDate`);
      }
      if (!["active", "achieved", "archived"].includes(g.status)) {
        errors.push(`goal[${i}]: invalid status`);
      }
    });
  }

  if (state.currentPhase && !["base", "build", "peak", "taper", "recovery"].includes(state.currentPhase)) {
    errors.push("currentPhase must be base|build|peak|taper|recovery");
  }

  if (typeof state.preferences !== "object" || Array.isArray(state.preferences)) {
    errors.push("preferences must be object");
  } else {
    if (state.preferences.longRunDay && !["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].includes(state.preferences.longRunDay)) {
      errors.push("preferences.longRunDay: invalid day");
    }
    if (state.preferences.qualitySessionsPerWeek && typeof state.preferences.qualitySessionsPerWeek !== "number") {
      errors.push("preferences.qualitySessionsPerWeek must be number");
    }
  }

  if (!Array.isArray(state.constraints)) {
    errors.push("constraints must be array");
  }

  if (!Array.isArray(state.notes)) {
    errors.push("notes must be array");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Update coach state goal.
 */
export function updateGoal(state: CoachState, goal: TrainingGoal): CoachState {
  const existing = state.goals.findIndex((g) => g.id === goal.id);
  if (existing >= 0) {
    const newGoals = [...state.goals];
    newGoals[existing] = goal;
    return { ...state, goals: newGoals, updatedAt: new Date().toISOString() };
  }
  return {
    ...state,
    goals: [...state.goals, goal],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Add coach note.
 */
export function addNote(state: CoachState, note: string): CoachState {
  if (note.length > 500) {
    throw new Error("Note too long (max 500 chars)");
  }
  return {
    ...state,
    notes: [...state.notes.slice(-9), note], // Keep last 10 notes
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Update preferences.
 */
export function updatePreferences(state: CoachState, prefs: Partial<CoachPreferences>): CoachState {
  return {
    ...state,
    preferences: { ...state.preferences, ...prefs },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Serialize coach state for storage (JSON-safe).
 */
export function serializeCoachState(state: CoachState): string {
  return JSON.stringify(state);
}

/**
 * Deserialize coach state from storage.
 */
export function deserializeCoachState(json: string): CoachState {
  const parsed = JSON.parse(json);
  const validation = validateCoachState(parsed);
  if (!validation.valid) {
    throw new Error(`Invalid coach state: ${validation.errors.join(", ")}`);
  }
  return parsed;
}
