//  Store.swift — the active-workout state machine, ported from
//  src/lib/stores/workout.svelte.ts.
//
//  Swift's @Observable is the direct analogue of Svelte 5 runes: mutate a property,
//  the views that read it re-render. The port keeps the web app's hard-won rules:
//    * a live workout is NEVER silently overwritten by a new start
//    * the rest timer is WALL-CLOCK DERIVED, never tick-incremented, so it stays
//      correct across suspension (the whole reason the web version works on iOS)
//    * a COMPLETED set is a record, not a plan — nothing rewrites its numbers
import Foundation
import Observation

@Observable
final class WorkoutStore {
    // MARK: catalog (seeded in-memory: this is a UI pilot, not a data migration)
    private(set) var exercises: [Exercise] = []
    private(set) var templates: [WorkoutTemplate] = []
    private(set) var history: [WorkoutSession] = []

    // MARK: active workout
    var session: WorkoutSession?
    var activeEx = 0
    var activeSet = 0
    var isActive: Bool { session != nil }

    // MARK: rest timer — derived from timestamps, never accumulated
    var restRunning = false
    var restSeedSec = 0
    var restStartedAt: Date?
    /// Ticks only to force a re-render; the VALUE is always recomputed from dates.
    var now: Date = .now

    var restElapsedSec: Double {
        guard let started = restStartedAt, restRunning else { return 0 }
        return max(0, now.timeIntervalSince(started))
    }
    var restRemainingSec: Double { Double(restSeedSec) - restElapsedSec }
    var restIsOver: Bool { restRemainingSec < 0 }

    func exercise(_ id: String) -> Exercise? { exercises.first { $0.id == id } }

    init() { seed() }

    // MARK: - starting

    enum StartResult { case ok, alreadyInProgress }

    /// Mirrors the web app's P0 fix: a live session is never clobbered. The caller
    /// decides what to offer (resume, or discard then start).
    @discardableResult
    func start(template: WorkoutTemplate) -> StartResult {
        guard session == nil else { return .alreadyInProgress }
        let logged = template.exercises.map { te in
            LoggedExercise(
                exerciseId: te.exerciseId,
                sets: te.plannedSets.map { ps in
                    // prefill from the plan, but nothing is COMPLETED — a prefilled
                    // row is a target until the user ticks it
                    LoggedSet(reps: ps.targetReps, weight: ps.targetWeight, durationSec: ps.targetDurationSec)
                }
            )
        }
        session = WorkoutSession(sourceTemplateId: template.id, title: template.name, exercises: logged)
        activeEx = 0
        activeSet = 0
        return .ok
    }

    @discardableResult
    func startQuick() -> StartResult {
        guard session == nil else { return .alreadyInProgress }
        session = WorkoutSession(title: "Quick log", exercises: [])
        return .ok
    }

    // MARK: - editing sets

    func addSet(_ exIndex: Int) {
        guard var s = session, s.exercises.indices.contains(exIndex) else { return }
        // carry the last row forward — the next set is nearly always the same
        let last = s.exercises[exIndex].sets.last
        s.exercises[exIndex].sets.append(
            LoggedSet(reps: last?.reps, weight: last?.weight, durationSec: last?.durationSec)
        )
        session = s
    }

    func removeLastSet(_ exIndex: Int) {
        guard var s = session, s.exercises.indices.contains(exIndex),
              s.exercises[exIndex].sets.count > 1 else { return }
        s.exercises[exIndex].sets.removeLast()
        session = s
    }

    func toggleSet(_ exIndex: Int, _ setIndex: Int) {
        guard var s = session,
              s.exercises.indices.contains(exIndex),
              s.exercises[exIndex].sets.indices.contains(setIndex) else { return }
        let nowCompleted = !s.exercises[exIndex].sets[setIndex].completed
        s.exercises[exIndex].sets[setIndex].completed = nowCompleted
        session = s

        if nowCompleted {
            let seed = exercise(s.exercises[exIndex].exerciseId)?.defaultRestSec ?? 0
            // a seed of 0 means "no rest" — arming the timer anyway is what made the
            // web app fire a red overage banner on cardio sets
            if seed > 0 { startRest(seconds: seed) } else { stopRest() }
            advanceToFirstIncomplete()
        } else {
            stopRest()
        }
    }

    private func advanceToFirstIncomplete() {
        guard let s = session, s.exercises.indices.contains(activeEx) else { return }
        if let next = s.exercises[activeEx].sets.firstIndex(where: { !$0.completed }) {
            activeSet = next
        } else if activeEx + 1 < s.exercises.count {
            activeEx += 1
            activeSet = 0
        }
    }

    // MARK: - apply to the rest (ported from applyToUnlogged)

    /// Sets the action would actually change: not the source, NOT COMPLETED, and
    /// not already holding the value. Zero means the affordance must not appear.
    func spreadTargets(_ exIndex: Int, _ setIndex: Int, _ field: SpreadField) -> [Int] {
        guard let s = session, s.exercises.indices.contains(exIndex) else { return [] }
        let sets = s.exercises[exIndex].sets
        guard sets.indices.contains(setIndex) else { return [] }
        let src = sets[setIndex]
        return sets.indices.filter { i in
            guard i != setIndex, !sets[i].completed else { return false }
            switch field {
            case .weight:
                guard let v = src.weight else { return false }
                return sets[i].weight != v
            case .durationSec:
                guard let v = src.durationSec else { return false }
                return sets[i].durationSec != v
            }
        }
    }

    /// Copy one set's weight/time onto every UNLOGGED set of the same exercise.
    /// A completed set is never touched: its numbers are what was actually lifted,
    /// and the volume math above reads exactly those values.
    @discardableResult
    func applyToUnlogged(_ exIndex: Int, _ setIndex: Int, _ field: SpreadField) -> Int {
        let targets = spreadTargets(exIndex, setIndex, field)
        guard var s = session, !targets.isEmpty else { return 0 }
        let src = s.exercises[exIndex].sets[setIndex]
        for i in targets {
            switch field {
            case .weight: s.exercises[exIndex].sets[i].weight = src.weight
            case .durationSec: s.exercises[exIndex].sets[i].durationSec = src.durationSec
            }
        }
        session = s
        return targets.count
    }

    // MARK: - rest

    func startRest(seconds: Int) {
        restSeedSec = seconds
        restStartedAt = .now
        restRunning = true
        now = .now
    }
    func stopRest() {
        restRunning = false
        restStartedAt = nil
        restSeedSec = 0
    }
    func adjustRest(_ delta: Int) { restSeedSec = max(5, restSeedSec + delta) }

    // MARK: - finishing

    enum FinishResult { case saved(WorkoutSession), nothingLogged, empty }

    /// Keeps the web app's honesty fix: finishing with nothing ticked does NOT
    /// silently destroy the workout — the caller is told and decides.
    func finish() -> FinishResult {
        guard let s = session else { return .empty }
        if s.exercises.isEmpty { session = nil; return .empty }
        if s.completedSetCount == 0 { return .nothingLogged }

        var out = s
        out.endedAt = .now
        // keep only completed sets, then drop exercises left empty
        out.exercises = out.exercises.compactMap { le in
            let kept = le.sets.filter(\.completed)
            return kept.isEmpty ? nil : LoggedExercise(id: le.id, exerciseId: le.exerciseId, sets: kept)
        }
        history.insert(out, at: 0)
        session = nil
        stopRest()
        return .saved(out)
    }

    func discard() {
        session = nil
        stopRest()
    }

    // MARK: - library

    func deleteTemplate(_ id: UUID) { templates.removeAll { $0.id == id } }

    func duplicateTemplate(_ id: UUID) {
        guard let t = templates.first(where: { $0.id == id }) else { return }
        var copy = t
        copy.id = UUID()
        copy.name = "\(t.name) copy"
        copy.createdAt = .now
        // fresh row ids so the two templates never share identity
        copy.exercises = t.exercises.map { TemplateExercise(exerciseId: $0.exerciseId, plannedSets: $0.plannedSets) }
        templates.insert(copy, at: (templates.firstIndex(where: { $0.id == id }) ?? 0) + 1)
    }

    /// Reorder the library itself (List's .onMove hands back the whole array).
    func reorderTemplates(_ ordered: [WorkoutTemplate]) { templates = ordered }

    func moveExercises(in templateId: UUID, from: IndexSet, to: Int) {
        guard let ti = templates.firstIndex(where: { $0.id == templateId }) else { return }
        templates[ti].exercises.move(fromOffsets: from, toOffset: to)
    }

    /// Last-performed / times-completed, derived from history exactly like the web
    /// app's templateStats.ts — no stored counters to drift.
    func stats(for templateId: UUID) -> (last: Date?, count: Int) {
        let mine = history.filter { $0.sourceTemplateId == templateId && $0.endedAt != nil }
        return (mine.compactMap(\.endedAt).max(), mine.count)
    }

    // MARK: - seed

    private func seed() {
        let ex: [Exercise] = [
            .init(id: "bench", name: "Barbell Bench Press", equipment: .barbell, primaryMuscles: ["Chest"], defaultRestSec: 120),
            .init(id: "ohp", name: "Overhead Press", equipment: .barbell, primaryMuscles: ["Shoulders"], defaultRestSec: 120),
            .init(id: "curl", name: "Dumbbell Curl", equipment: .dumbbell, primaryMuscles: ["Biceps"], loadType: .perSide, defaultRestSec: 75, weightStep: 1),
            .init(id: "squat", name: "Barbell Back Squat", equipment: .barbell, primaryMuscles: ["Quads"], defaultRestSec: 150),
            .init(id: "pullup", name: "Pull-up", equipment: .bodyweight, primaryMuscles: ["Back"], loadType: .bodyweight, defaultRestSec: 120),
            .init(id: "plank", name: "Plank", equipment: .bodyweight, primaryMuscles: ["Abs"], trackingType: .timeHold, loadType: .bodyweight, defaultRestSec: 60)
        ]
        exercises = ex
        func w(_ reps: Int, _ kg: Double, _ rest: Int) -> PlannedSet {
            PlannedSet(targetReps: reps, targetWeight: kg, targetRestSec: rest)
        }
        templates = [
            .init(name: "Push Day", exercises: [
                .init(exerciseId: "bench", plannedSets: [w(8, 82.5, 120), w(8, 82.5, 120), w(8, 82.5, 120)]),
                .init(exerciseId: "ohp", plannedSets: [w(8, 47.5, 120), w(8, 47.5, 120)]),
                .init(exerciseId: "plank", plannedSets: [PlannedSet(targetDurationSec: 45, targetRestSec: 60)])
            ]),
            .init(name: "Pull Day", exercises: [
                .init(exerciseId: "pullup", plannedSets: [w(8, 0, 120), w(8, 0, 120), w(8, 0, 120)]),
                .init(exerciseId: "curl", plannedSets: [w(12, 14, 75), w(12, 14, 75)])
            ]),
            .init(name: "Leg Day", exercises: [
                .init(exerciseId: "squat", plannedSets: [w(5, 102.5, 150), w(5, 102.5, 150), w(5, 102.5, 150)])
            ])
        ]
        // one finished session so the library can show real "last trained" data
        let day: TimeInterval = 86_400
        var past = WorkoutSession(
            startedAt: .now.addingTimeInterval(-2 * day),
            sourceTemplateId: templates[0].id,
            title: "Push Day",
            exercises: [
                LoggedExercise(exerciseId: "bench", sets: [
                    LoggedSet(completed: true, reps: 8, weight: 80),
                    LoggedSet(completed: true, reps: 8, weight: 80),
                    LoggedSet(completed: true, reps: 7, weight: 80)
                ])
            ]
        )
        past.endedAt = .now.addingTimeInterval(-2 * day + 3_300)
        history = [past]
    }
}
