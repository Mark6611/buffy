import SwiftUI
import WidgetKit

private let brand = Color(red: 0.243, green: 0.435, blue: 0.831) // #3E6FD4

struct BuffyWidgetEntry: TimelineEntry {
	let date: Date
	let snapshot: WidgetSnapshot?
}

struct BuffyWidgetProvider: TimelineProvider {
	func placeholder(in context: Context) -> BuffyWidgetEntry {
		BuffyWidgetEntry(
			date: Date(),
			snapshot: WidgetSnapshot(
				streakDays: 3, volumeThisWeekKg: 4200, sessionsThisWeek: 2,
				nextOrLastTitle: "Legs", isNext: true, updatedAt: ""
			)
		)
	}

	func getSnapshot(in context: Context, completion: @escaping (BuffyWidgetEntry) -> Void) {
		completion(BuffyWidgetEntry(date: Date(), snapshot: WidgetSnapshotStore.read()))
	}

	func getTimeline(in context: Context, completion: @escaping (Timeline<BuffyWidgetEntry>) -> Void) {
		let snapshot = WidgetSnapshotStore.read()
		let cal = Calendar.current
		let now = Date()
		// Render now, then re-render at the next two local midnights. The view decides
		// freshness from each entry's date, so a stale snapshot's week numbers zero out
		// and its streak flame disappears ON TIME even if the app is never opened —
		// instead of the same App Group file being re-shown as "current" for days.
		var dates = [now]
		if let m1 = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: now)) {
			dates.append(m1)
			if let m2 = cal.date(byAdding: .day, value: 1, to: m1) { dates.append(m2) }
		}
		let entries = dates.map { BuffyWidgetEntry(date: $0, snapshot: snapshot) }
		let next = cal.date(byAdding: .hour, value: 4, to: now) ?? now.addingTimeInterval(4 * 3600)
		completion(Timeline(entries: entries, policy: .after(next)))
	}
}

struct BuffyHomeWidgetView: View {
	var entry: BuffyWidgetProvider.Entry
	@Environment(\.widgetFamily) var family

	var body: some View {
		if let s = entry.snapshot {
			VStack(alignment: .leading, spacing: 8) {
				HStack {
					Image(systemName: "dumbbell.fill").foregroundStyle(brand)
					Text("Buffy").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
					Spacer()
					if s.streakDays > 0 && streakFresh(s) {
						Label("\(s.streakDays)", systemImage: "flame.fill")
							.font(.caption.weight(.semibold))
							.foregroundStyle(.orange)
					}
				}
				Spacer(minLength: 0)
				if family == .systemSmall {
					Text(volumeLabel(shownVolume(s)))
						.font(.system(.title2, design: .rounded)).fontWeight(.bold)
					Text("\(shownSessions(s)) session\(shownSessions(s) == 1 ? "" : "s") this week")
						.font(.caption2).foregroundStyle(.secondary)
				} else {
					HStack(alignment: .firstTextBaseline) {
						VStack(alignment: .leading, spacing: 2) {
							Text(volumeLabel(shownVolume(s))).font(.system(.title2, design: .rounded)).fontWeight(.bold)
							Text("volume this week").font(.caption2).foregroundStyle(.secondary)
						}
						Spacer()
						VStack(alignment: .leading, spacing: 2) {
							Text("\(shownSessions(s))").font(.system(.title2, design: .rounded)).fontWeight(.bold)
							Text("sessions").font(.caption2).foregroundStyle(.secondary)
						}
					}
				}
				if !s.nextOrLastTitle.isEmpty {
					Text(s.isNext ? "Next up: \(s.nextOrLastTitle)" : "Last: \(s.nextOrLastTitle)")
						.font(.caption2).foregroundStyle(.secondary).lineLimit(1)
				}
			}
			.padding(14)
		} else {
			VStack(spacing: 6) {
				Image(systemName: "dumbbell").font(.title2).foregroundStyle(brand)
				Text("Open Buffy to get started").font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
			}
			.padding(14)
		}
	}

	private func volumeLabel(_ kg: Double) -> String {
		kg >= 1000 ? String(format: "%.1fK kg", kg / 1000) : String(format: "%.0f kg", kg)
	}

	// Staleness gates, evaluated against THIS entry's date (its intended render time),
	// so the numbers lapse on the day boundaries the timeline schedules. WidgetSnapshot
	// serializes updatedAt precisely for this; it was written but never read before.
	private static func parseISO(_ s: String) -> Date? {
		guard !s.isEmpty else { return nil }
		let f = ISO8601DateFormatter()
		f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		if let d = f.date(from: s) { return d }
		f.formatOptions = [.withInternetDateTime]
		return f.date(from: s)
	}
	// "This week" numbers are current only if the snapshot was written this week.
	private func weekFresh(_ s: WidgetSnapshot) -> Bool {
		guard let u = Self.parseISO(s.updatedAt) else { return false }
		let cal = Calendar.current
		let weekStart = cal.dateInterval(of: .weekOfYear, for: entry.date)?.start ?? cal.startOfDay(for: entry.date)
		return u >= weekStart
	}
	// The streak flame is trustworthy only if the snapshot is from today or yesterday.
	private func streakFresh(_ s: WidgetSnapshot) -> Bool {
		guard let u = Self.parseISO(s.updatedAt) else { return false }
		let cal = Calendar.current
		let cutoff = cal.date(byAdding: .day, value: -1, to: cal.startOfDay(for: entry.date)) ?? entry.date
		return u >= cutoff
	}
	private func shownVolume(_ s: WidgetSnapshot) -> Double { weekFresh(s) ? s.volumeThisWeekKg : 0 }
	private func shownSessions(_ s: WidgetSnapshot) -> Int { weekFresh(s) ? s.sessionsThisWeek : 0 }
}

private let widgetBg = Color(red: 0.98, green: 0.973, blue: 0.957) // #faf8f4

struct BuffyHomeWidget: Widget {
	let kind = "BuffyHomeWidget"
	var body: some WidgetConfiguration {
		StaticConfiguration(kind: kind, provider: BuffyWidgetProvider()) { entry in
			if #available(iOS 17.0, *) {
				BuffyHomeWidgetView(entry: entry).containerBackground(widgetBg, for: .widget)
			} else {
				BuffyHomeWidgetView(entry: entry).background(widgetBg)
			}
		}
		.configurationDisplayName("Buffy")
		.description("Streak, weekly volume, and your next workout.")
		.supportedFamilies([.systemSmall, .systemMedium])
	}
}
