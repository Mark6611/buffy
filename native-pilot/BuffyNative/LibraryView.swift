//  LibraryView.swift — the Workout Library, native.
//
//  Same information architecture as the web app's home screen after this pass:
//  template cards carrying last-performed + times-completed (derived from history,
//  never stored), a one-tap Start, an empty state, and delete/duplicate/reorder.
//
//  What is free here and had to be BUILT in the web app:
//    * swipe-to-delete and drag-to-reorder are List primitives (the web app has a
//      hand-written pointer-drag SwipeActions component with its own state machine)
//    * every row is already a 44pt target with correct VoiceOver semantics
//    * Dynamic Type scales without a token ramp
import SwiftUI

struct LibraryView: View {
    @Environment(WorkoutStore.self) private var store
    @State private var startBlocked = false
    @State private var pendingDelete: WorkoutTemplate?

    var body: some View {
        @Bindable var store = store
        NavigationStack {
            ZStack {
                Theme.paper.ignoresSafeArea()
                if store.templates.isEmpty {
                    emptyState
                } else {
                    list
                }
            }
            .navigationTitle("Workouts")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        if store.startQuick() == .alreadyInProgress { startBlocked = true }
                    } label: {
                        Label("Quick log", systemImage: "bolt.fill")
                    }
                }
            }
            .navigationDestination(isPresented: Binding(
                get: { store.isActive },
                set: { if !$0 { } }   // dismissal is owned by the workout screen
            )) {
                WorkoutView()
            }
            // Mirrors the web app's P0 fix: a live workout is never clobbered.
            .alert("Workout already in progress", isPresented: $startBlocked) {
                Button("Resume") { }
                Button("Discard it and start", role: .destructive) { store.discard() }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("Finish or discard the current workout before starting another.")
            }
            .confirmationDialog(
                "Delete “\(pendingDelete?.name ?? "")”?",
                isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                titleVisibility: .visible
            ) {
                Button("Delete template", role: .destructive) {
                    if let t = pendingDelete { store.deleteTemplate(t.id) }
                    pendingDelete = nil
                }
                Button("Cancel", role: .cancel) { pendingDelete = nil }
            } message: {
                Text("Workouts you already logged from it are kept in history.")
            }
        }
        .tint(Theme.accentInk)
    }

    private var list: some View {
        List {
            Section {
                ForEach(store.templates) { t in
                    TemplateRow(template: t) {
                        if store.start(template: t) == .alreadyInProgress { startBlocked = true }
                    }
                    .listRowBackground(Theme.surface)
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) { pendingDelete = t } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        Button { store.duplicateTemplate(t.id) } label: {
                            Label("Duplicate", systemImage: "plus.square.on.square")
                        }
                        .tint(Theme.accentInk)
                    }
                }
                .onMove { from, to in
                    var t = store.templates
                    t.move(fromOffsets: from, toOffset: to)
                    store.reorderTemplates(t)
                }
            } header: {
                Text("My Templates").foregroundStyle(Theme.ink3)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .environment(\.editMode, .constant(.transient))
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "dumbbell")
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(Theme.accentInk)
            Text("No templates yet")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.ink)
            Text("Save a workout you do often and it starts in one tap next time.")
                .font(.subheadline)
                .foregroundStyle(Theme.ink2)
                .multilineTextAlignment(.center)
            Button("Quick log a workout") { store.startQuick() }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accentSolid)
                .controlSize(.large)
        }
        .padding(28)
    }
}

private struct TemplateRow: View {
    @Environment(WorkoutStore.self) private var store
    let template: WorkoutTemplate
    let onStart: () -> Void

    var body: some View {
        let s = store.stats(for: template.id)
        HStack(spacing: 13) {
            VStack(alignment: .leading, spacing: 5) {
                Text(template.name)
                    .font(.headline)
                    .foregroundStyle(Theme.ink)
                Text("\(template.exercises.count) exercises · \(template.setCount) sets")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                // last-performed + times-completed, DERIVED from history — the web
                // app's widget knew this before the app itself did
                Text(lastLabel(s.last, count: s.count))
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: 8)
            Button(action: onStart) {
                Text("Start")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 14)
                    .frame(height: 36)
                    .background(Theme.accentSolid)
                    .foregroundStyle(.white)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .frame(minWidth: Theme.hit, minHeight: Theme.hit)
            .accessibilityLabel("Start \(template.name)")
        }
        .padding(.vertical, 6)
    }

    private func lastLabel(_ date: Date?, count: Int) -> String {
        guard let date else { return "Not trained yet" }
        let days = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: date), to: Calendar.current.startOfDay(for: .now)).day ?? 0
        let when = days == 0 ? "today" : days == 1 ? "yesterday" : "\(days) days ago"
        return "Last trained \(when) · \(count) time\(count == 1 ? "" : "s")"
    }
}
