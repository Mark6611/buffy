import { describe, it, expect } from "vitest";
import {
  setVolume,
  sessionVolume,
  sessionSetCount,
  sessionDurationSec,
  cardioDistanceKm,
  cardioSplit500Sec,
  cardioPaceSecPerKm,
  templateDerived,
} from "$lib/compute";
import type { LoggedSet, WorkoutSession, Template, Exercise } from "$lib/types";

const set = (o: Partial<LoggedSet>): LoggedSet => ({
  index: 0,
  completed: true,
  ...o,
});

describe("setVolume", () => {
  it("weight × reps", () =>
    expect(setVolume(set({ weight: 40, reps: 8 }))).toBe(320));
  it("per-side doubles", () =>
    expect(setVolume(set({ weight: 12.5, reps: 10, perSide: true }))).toBe(
      250
    ));
  it("bodyweight (no weight) → 0", () =>
    expect(setVolume(set({ reps: 10 }))).toBe(0));
});

describe("session aggregates", () => {
  const sess: WorkoutSession = {
    id: "x",
    startedAt: "2026-06-03T10:00:00Z",
    endedAt: "2026-06-03T10:45:00Z",
    sourceTemplateId: "t",
    exercises: [
      {
        exerciseId: "a",
        sets: [set({ weight: 40, reps: 8 }), set({ weight: 40, reps: 8 })],
      },
    ],
  };
  it("volume sums all sets", () => expect(sessionVolume(sess)).toBe(640));
  it("counts completed sets", () => expect(sessionSetCount(sess)).toBe(2));
  it("duration in seconds", () => expect(sessionDurationSec(sess)).toBe(2700));
});

describe("cardioDistanceKm", () => {
  it("speed × time / 3600 (treadmill)", () =>
    expect(cardioDistanceKm(set({ speed: 6, timeSec: 600 }))).toBe(1));
  it("prefers directly-logged metres (erg/rower)", () =>
    expect(cardioDistanceKm(set({ distanceMeters: 2000, timeSec: 480 }))).toBe(
      2
    ));
  it("missing inputs → undefined", () =>
    expect(cardioDistanceKm(set({ speed: 6 }))).toBeUndefined());
});

describe("cardio split / pace", () => {
  it("/500m split: 2000m in 8:00 → 2:00 (120s)", () =>
    expect(cardioSplit500Sec(set({ distanceMeters: 2000, timeSec: 480 }))).toBe(
      120
    ));
  it("pace per km: 2km in 8:00 → 4:00/km (240s)", () =>
    expect(
      cardioPaceSecPerKm(set({ distanceMeters: 2000, timeSec: 480 }))
    ).toBe(240));
  it("undefined without positive distance + time", () => {
    expect(
      cardioSplit500Sec(set({ distanceMeters: 0, timeSec: 480 }))
    ).toBeUndefined();
    expect(cardioPaceSecPerKm(set({ distanceMeters: 2000 }))).toBeUndefined();
  });
});

describe("templateDerived", () => {
  const ex: Exercise = {
    id: "a",
    name: "A",
    equipment: "barbell",
    primaryMuscles: ["Chest"],
    secondaryMuscles: [],
    trackingType: "weight_reps",
    loadType: "total",
    defaultRestSec: 60,
  };
  const t: Template = {
    id: "t",
    name: "T",
    groups: [],
    createdAt: "",
    updatedAt: "",
    exercises: [
      {
        exerciseId: "a",
        plannedSets: [{ targetRestSec: 90 }, { targetRestSec: 90 }],
      },
    ],
  };
  it("derives muscles, equipment, setCount, duration", () => {
    const d = templateDerived(t, new Map([["a", ex]]));
    expect(d.muscles).toEqual(["Chest"]);
    expect(d.equipment).toEqual(["barbell"]);
    expect(d.setCount).toBe(2);
    expect(d.estDurationSec).toBe(2 * (35 + 90));
  });
});
