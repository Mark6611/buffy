//  WorkoutView.swift — the live workout. This is the screen the pilot exists for.
//
//  THE POINT: every numeric cell here is a real UITextField. Tapping one twice in
//  quick succession focuses it — it cannot zoom the screen, because there is no
//  WebView and no double-tap-to-zoom gesture to suppress. In the Capacitor build
//  the same two taps are a zoom gesture unless CSS opts out of it.
//
//  Also native for free: .keyboardType(.decimalPad) gives the right keypad with no
//  inputmode guessing, .submitLabel/focus moves between fields, sensory feedback is
//  one modifier, and the rest banner is a real safeAreaInset that cannot scroll away
//  (the web app's equivalent scrolls off with its exercise card).
import SwiftUI

struct WorkoutView: View {
    @Environment(WorkoutStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var spread: SpreadOffer?
    @State private var confirmDiscard = false
    @State private var nothingLogged = false
    @FocusState private var focused: FieldID?

    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    struct SpreadOffer: Equatable {
        var ex: Int, set: Int, field: SpreadField, label: String, count: Int
        static func == (a: Self, b: Self) -> Bool { a.ex == b.ex && a.set == b.set && a.count == b.count && a.label == b.label }
    }
    struct FieldID: Hashable { var ex: Int, set: Int, col: Int }

    var body: some View {
        ZStack {
            Theme.paper.ignoresSafeArea()
            if let session = store.session {
                ScrollView {
                    VStack(spacing: 14) {
                        ForEach(Array(session.exercises.enumerated()), id: \.element.id) { exIndex, le in
                            exerciseCard(exIndex: exIndex, le: le)
                        }
                    }
                    .padding(16)
                    .padding(.bottom, 90)
                }
                // Tapping off a field is how people actually leave one, and in the
                // gym it happens with a thumb somewhere in the middle of the card.
                // Without this the keypad stays up and the blur never fires.
                .scrollDismissesKeyboard(.interactively)
                .contentShape(Rectangle())
                .onTapGesture { focused = nil }
            }
        }
        .navigationTitle(store.session?.title ?? "Workout")
        .navigationBarTitleDisplayMode(.inline)
        // The system back chevron would sit next to "Minimise" and mean the same
        // thing twice. One leave-affordance, named for what it actually does.
        .navigationBarBackButtonHidden(true)
        .toolbar {
            // Leaving DEFAULTS to minimise — the workout stays alive, the same
            // contract the web app now honours. Discard is available but has to
            // be chosen, and then confirmed.
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Button("Minimise") { dismiss() }
                    Button("Discard workout", role: .destructive) { confirmDiscard = true }
                } label: {
                    Text("Leave")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Finish") { finish() }
                    .font(.headline)
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focused = nil }
            }
        }
        // A real inset: the rest timer is pinned and cannot scroll out of reach.
        .safeAreaInset(edge: .bottom) {
            if store.restRunning { restBanner }
        }
        .onReceive(tick) { _ in if store.restRunning { store.now = .now } }
        .confirmationDialog("Discard this workout?", isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button("Discard", role: .destructive) { store.discard(); dismiss() }
            Button("Keep logging", role: .cancel) { }
        }
        .alert("Nothing is ticked", isPresented: $nothingLogged) {
            Button("Keep logging", role: .cancel) { }
            Button("Discard", role: .destructive) { store.discard(); dismiss() }
        } message: {
            Text("No sets are marked complete, so there is nothing to save.")
        }
    }

    // MARK: - one exercise

    @ViewBuilder
    private func exerciseCard(exIndex: Int, le: LoggedExercise) -> some View {
        let ex = store.exercise(le.exerciseId)
        let isTime = ex?.trackingType == .timeHold
        VStack(alignment: .leading, spacing: 10) {
            Text(ex?.name ?? "Exercise")
                .font(.headline)
                .foregroundStyle(Theme.ink)

            HStack(spacing: 8) {
                Text("SET").frame(width: 34, alignment: .leading)
                Text(isTime ? "HOLD" : "REPS").frame(maxWidth: .infinity)
                if !isTime && ex?.loadType != .bodyweight {
                    Text(ex?.loadType == .perSide ? "KG ×2" : "KG").frame(maxWidth: .infinity)
                }
            }
            .font(.caption2.weight(.semibold))
            .foregroundStyle(Theme.ink3)

            ForEach(Array(le.sets.enumerated()), id: \.element.id) { s, set in
                setRow(exIndex: exIndex, s: s, set: set, ex: ex, isTime: isTime)
            }

            if let offer = spread, offer.ex == exIndex {
                applyChip(offer)
            }

            HStack(spacing: 18) {
                Button { spread = nil; store.addSet(exIndex) } label: {
                    Label("Add set", systemImage: "plus")
                }
                Button { spread = nil; store.removeLastSet(exIndex) } label: {
                    Label("Remove", systemImage: "minus")
                }
                .disabled(le.sets.count <= 1)
            }
            .font(.subheadline)
            .foregroundStyle(Theme.ink2)
            .padding(.top, 2)
        }
        .buffyCard()
    }

    @ViewBuilder
    private func setRow(exIndex: Int, s: Int, set: LoggedSet, ex: Exercise?, isTime: Bool) -> some View {
        @Bindable var store = store
        let done = set.completed
        HStack(spacing: 8) {
            Button {
                spread = nil
                store.toggleSet(exIndex, s)
            } label: {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 24))
                    .foregroundStyle(done ? Theme.accent : Theme.ink3)
            }
            .buttonStyle(.plain)
            .frame(width: Theme.hit, height: Theme.hit, alignment: .leading)
            .accessibilityLabel("Set \(s + 1) complete")
            .accessibilityAddTraits(done ? [.isSelected] : [])

            if isTime {
                numberField(
                    id: FieldID(ex: exIndex, set: s, col: 0),
                    value: Binding(
                        get: { store.session?.exercises[exIndex].sets[s].durationSec.map(Double.init) },
                        set: { store.session?.exercises[exIndex].sets[s].durationSec = $0.map { Int($0) } }
                    ),
                    label: "Set \(s + 1) hold seconds",
                    disabled: done,
                    onCommit: { offer(exIndex, s, .durationSec) }
                )
            } else {
                numberField(
                    id: FieldID(ex: exIndex, set: s, col: 0),
                    value: Binding(
                        get: { store.session?.exercises[exIndex].sets[s].reps.map(Double.init) },
                        set: { store.session?.exercises[exIndex].sets[s].reps = $0.map { Int($0) } }
                    ),
                    label: "Set \(s + 1) reps",
                    disabled: done,
                    // reps are per-set by nature — no spread offer
                    onCommit: { }
                )
                if ex?.loadType != .bodyweight {
                    numberField(
                        id: FieldID(ex: exIndex, set: s, col: 1),
                        value: Binding(
                            get: { store.session?.exercises[exIndex].sets[s].weight },
                            set: { store.session?.exercises[exIndex].sets[s].weight = $0 }
                        ),
                        label: "Set \(s + 1) weight in kilograms",
                        disabled: done,
                        onCommit: { offer(exIndex, s, .weight) }
                    )
                }
            }
        }
        .padding(.vertical, 3)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(done ? Theme.accentTint.opacity(0.55) : .clear)
        )
    }

    /// A decimal keypad with no guessing: iOS shows the right keys because the
    /// field says so, not because a CSS attribute hinted at it.
    private func numberField(id: FieldID, value: Binding<Double?>, label: String, disabled: Bool, onCommit: @escaping () -> Void) -> some View {
        TextField("", value: value, format: .number)
            .keyboardType(.decimalPad)
            .multilineTextAlignment(.center)
            .font(.system(.body, design: .monospaced))
            .foregroundStyle(disabled ? Theme.ink3 : Theme.ink)
            .disabled(disabled)
            .frame(maxWidth: .infinity, minHeight: 42)
            .background(Theme.surface2)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .accessibilityLabel(label)
            .focused($focused, equals: id)
            // Commit on BLUR, not per keystroke: typing "8" on the way to "85"
            // must not offer to spread 8 kg across the exercise. Each field only
            // reacts to focus LEAVING itself, so one edit raises one offer.
            //
            // The hop through the next main-actor turn is load-bearing, not
            // defensive noise. TextField(value:format:) parses and writes its
            // binding as part of ending editing, and that write is NOT ordered
            // before the focus change we are observing here. Reading the store
            // synchronously sees the OLD weight, computes zero targets, and
            // silently drops the offer — which is exactly how this first failed.
            .onChange(of: focused) { old, new in
                guard old == id, new != id else { return }
                Task { @MainActor in onCommit() }
            }
    }

    private func offer(_ ex: Int, _ set: Int, _ field: SpreadField) {
        let targets = store.spreadTargets(ex, set, field)
        guard !targets.isEmpty,
              let s = store.session?.exercises[ex].sets[set] else { spread = nil; return }
        let label = field == .weight ? "\(kgLabel(s.weight)) kg" : mmss(s.durationSec ?? 0)
        spread = SpreadOffer(ex: ex, set: set, field: field, label: label, count: targets.count)
    }

    /// The same affordance as the web app: states the value AND the count, so the
    /// blast radius is visible before the tap. Logged sets are never touched.
    private func applyChip(_ offer: SpreadOffer) -> some View {
        Button {
            store.applyToUnlogged(offer.ex, offer.set, offer.field)
            spread = nil
        } label: {
            Label(
                "Apply \(offer.label) to \(offer.count) more set\(offer.count == 1 ? "" : "s")",
                systemImage: "checkmark"
            )
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 12)
            .frame(minHeight: Theme.hit)
            .background(Theme.accentTint)
            .foregroundStyle(Theme.accentInk)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: offer)
    }

    private var restBanner: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("REST").font(.caption2.weight(.semibold))
                Text(mmss(Int(store.restRemainingSec.rounded())))
                    .font(.system(size: 30, weight: .semibold, design: .monospaced))
                    .monospacedDigit()
            }
            Spacer()
            Button("−15") { store.adjustRest(-15) }
            Button("+15") { store.adjustRest(15) }
            Button("Skip") { store.stopRest() }
        }
        .foregroundStyle(.white)
        .buttonStyle(.bordered)
        .tint(.white)
        .padding(16)
        .background(store.restIsOver ? Theme.warn : Theme.accentSolid)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .padding(.horizontal, 16)
    }

    private func finish() {
        focused = nil
        switch store.finish() {
        case .saved: dismiss()
        case .empty: dismiss()
        case .nothingLogged: nothingLogged = true
        }
    }
}
