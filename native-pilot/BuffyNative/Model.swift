//  Model.swift — the domain, mirrored from the web app's src/lib/types.ts.
//
//  Deliberately the SAME shape as the TypeScript model (Exercise / Template /
//  WorkoutSession / LoggedExercise / LoggedSet) so the pilot is a genuine
//  comparison of the UI layer rather than a different product wearing the same
//  name. Two conventions carried over verbatim:
//    * computed values (volume, 500m split) are DERIVED at read time, never stored
//    * weight is kg; `perSide` is the ×2 notation, not a doubled number
import Foundation

enum TrackingType: String, Codable { case weightReps, timeHold, cardio }
enum LoadType: String, Codable { case total, perSide, bodyweight }
enum Equipment: String, Codable, CaseIterable {
    case barbell, dumbbell, cable, machine, kettlebell, bodyweight, cardio
    var label: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
}

struct Exercise: Identifiable, Hashable, Codable {
    let id: String
    var name: String
    var equipment: Equipment
    var primaryMuscles: [String]
    var trackingType: TrackingType = .weightReps
    var loadType: LoadType = .total
    var defaultRestSec: Int = 90
    var weightStep: Double = 2.5
}

/// A planned set inside a template. Which fields apply depends on trackingType —
/// same optional-field model as the web app's PlannedSet.
struct PlannedSet: Hashable, Codable {
    var targetReps: Int?
    var targetWeight: Double?
    var targetDurationSec: Int?
    var targetRestSec: Int?
}

struct TemplateExercise: Identifiable, Hashable, Codable {
    var id = UUID()
    var exerciseId: String
    var plannedSets: [PlannedSet]
}

struct WorkoutTemplate: Identifiable, Hashable, Codable {
    var id = UUID()
    var name: String
    var exercises: [TemplateExercise]
    var createdAt: Date = .now

    var setCount: Int { exercises.reduce(0) { $0 + $1.plannedSets.count } }
}

/// One logged set. `completed` is the line between a PLAN and a RECORD — the
/// whole app hinges on it, and nothing may rewrite a completed set's numbers.
struct LoggedSet: Identifiable, Hashable, Codable {
    var id = UUID()
    var completed = false
    var reps: Int?
    var weight: Double?
    var durationSec: Int?
}

struct LoggedExercise: Identifiable, Hashable, Codable {
    var id = UUID()
    var exerciseId: String
    var sets: [LoggedSet]
}

struct WorkoutSession: Identifiable, Hashable, Codable {
    var id = UUID()
    var startedAt: Date = .now
    var endedAt: Date?
    var sourceTemplateId: UUID?
    var title: String
    var exercises: [LoggedExercise]

    /// Derived, never stored — matches compute.ts. Only COMPLETED sets count:
    /// an untouched prefilled row is a plan, not work done.
    var volumeKg: Double {
        exercises.reduce(0) { acc, le in
            acc + le.sets.reduce(0) { $0 + (($1.completed ? $1.weight : nil) ?? 0) * Double(($1.completed ? $1.reps : nil) ?? 0) }
        }
    }
    var completedSetCount: Int {
        exercises.reduce(0) { $0 + $1.sets.filter(\.completed).count }
    }
}

/// The fields "apply to the rest of this exercise" can spread. Reps are absent for
/// the same reason as in the web app: reps are what you managed on the day, so
/// spreading one set's outcome would overwrite the target rather than fill it in.
enum SpreadField { case weight, durationSec }
