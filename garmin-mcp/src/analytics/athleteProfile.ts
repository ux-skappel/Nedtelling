/**
 * Athlete-specific metrics from Garmin and system config.
 * Priority: athlete data > system config > conservative fallbacks.
 */

import * as api from "../garmin/endpoints.js";
import { withCache } from "../garmin/cache.js";

export interface AthleteHRMetrics {
  restingHR?: number;
  maxHR?: number;
  thresholdHR?: number; // Lactate threshold
  zones?: {
    zone1: { min: number; max: number }; // Recovery
    zone2: { min: number; max: number }; // Endurance
    zone3: { min: number; max: number }; // Tempo
    zone4: { min: number; max: number }; // Threshold
    zone5: { min: number; max: number }; // VO2 Max
  };
}

export interface AthleteProfile {
  hrMetrics: AthleteHRMetrics;
  source: {
    restingHR: "garmin" | "config" | "fallback";
    maxHR: "garmin" | "config" | "fallback";
    thresholdHR: "garmin" | "config" | "fallback";
    zones: "garmin" | "config" | "fallback";
  };
}

const DEFAULT_CONFIG = {
  restingHR: 50,
  maxHR: 200,
  thresholdHR: 170,
};

/**
 * Fetch athlete-specific HR settings from Garmin user settings.
 * Garmin exposes: restingHeartRate, maxHeartRate, heartRateZones, etc.
 */
async function fetchGarminAthleteMetrics(): Promise<AthleteHRMetrics | null> {
  try {
    const settings = (await withCache("athlete:settings", () => api.getUserSettings())) as any;
    if (!settings) return null;

    const metrics: AthleteHRMetrics = {};

    if (typeof settings.restingHeartRate === "number" && settings.restingHeartRate > 0) {
      metrics.restingHR = settings.restingHeartRate;
    }
    if (typeof settings.maxHeartRate === "number" && settings.maxHeartRate > 0) {
      metrics.maxHR = settings.maxHeartRate;
    }
    if (typeof settings.lactateThresholdHeartRate === "number" && settings.lactateThresholdHeartRate > 0) {
      metrics.thresholdHR = settings.lactateThresholdHeartRate;
    }

    // Parse Garmin HR zones if available
    if (Array.isArray(settings.heartRateZones) && settings.heartRateZones.length >= 5) {
      const zones = settings.heartRateZones;
      metrics.zones = {
        zone1: { min: zones[0]?.min ?? 0, max: zones[0]?.max ?? 100 },
        zone2: { min: zones[1]?.min ?? 100, max: zones[1]?.max ?? 130 },
        zone3: { min: zones[2]?.min ?? 130, max: zones[2]?.max ?? 150 },
        zone4: { min: zones[3]?.min ?? 150, max: zones[3]?.max ?? 170 },
        zone5: { min: zones[4]?.min ?? 170, max: zones[4]?.max ?? 200 },
      };
    }

    return Object.keys(metrics).length > 0 ? metrics : null;
  } catch {
    return null;
  }
}

/**
 * Get athlete profile with fallback chain: Garmin > config > defaults.
 */
export async function getAthleteProfile(): Promise<AthleteProfile> {
  const garminMetrics = await fetchGarminAthleteMetrics();

  const profile: AthleteProfile = {
    hrMetrics: {
      restingHR: garminMetrics?.restingHR ?? DEFAULT_CONFIG.restingHR,
      maxHR: garminMetrics?.maxHR ?? DEFAULT_CONFIG.maxHR,
      thresholdHR: garminMetrics?.thresholdHR ?? DEFAULT_CONFIG.thresholdHR,
      zones: garminMetrics?.zones,
    },
    source: {
      restingHR: garminMetrics?.restingHR ? "garmin" : "fallback",
      maxHR: garminMetrics?.maxHR ? "garmin" : "fallback",
      thresholdHR: garminMetrics?.thresholdHR ? "garmin" : "fallback",
      zones: garminMetrics?.zones ? "garmin" : "fallback",
    },
  };

  return profile;
}

/**
 * Calculate HR reserve (max - resting).
 */
export function hrReserve(profile: AthleteProfile): number {
  return Math.max(profile.hrMetrics.maxHR! - (profile.hrMetrics.restingHR ?? 50), 50);
}

/**
 * Calculate HR as percentage of reserve (useful for intensity classification).
 */
export function hrPercentageOfReserve(hr: number, profile: AthleteProfile): number {
  const resting = profile.hrMetrics.restingHR ?? 50;
  return Math.max(0, (hr - resting) / hrReserve(profile));
}

/**
 * Calculate HR as percentage of max (simpler, often used).
 */
export function hrPercentageOfMax(hr: number, profile: AthleteProfile): number {
  return Math.max(0, hr / (profile.hrMetrics.maxHR ?? 200));
}
