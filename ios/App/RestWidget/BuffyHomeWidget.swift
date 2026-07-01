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
		let entry = BuffyWidgetEntry(date: Date(), snapshot: WidgetSnapshotStore.read())
		// The app pushes a fresh snapshot (+ reloadAllTimelines) after every workout and
		// on foreground, so this periodic refresh is just a safety net for staleness.
		let next = Calendar.current.date(byAdding: .hour, value: 4, to: Date()) ?? Date().addingTimeInterval(4 * 3600)
		completion(Timeline(entries: [entry], policy: .after(next)))
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
					if s.streakDays > 0 {
						Label("\(s.streakDays)", systemImage: "flame.fill")
							.font(.caption.weight(.semibold))
							.foregroundStyle(.orange)
					}
				}
				Spacer(minLength: 0)
				if family == .systemSmall {
					Text(volumeLabel(s.volumeThisWeekKg))
						.font(.system(.title2, design: .rounded)).fontWeight(.bold)
					Text("\(s.sessionsThisWeek) session\(s.sessionsThisWeek == 1 ? "" : "s") this week")
						.font(.caption2).foregroundStyle(.secondary)
				} else {
					HStack(alignment: .firstTextBaseline) {
						VStack(alignment: .leading, spacing: 2) {
							Text(volumeLabel(s.volumeThisWeekKg)).font(.system(.title2, design: .rounded)).fontWeight(.bold)
							Text("volume this week").font(.caption2).foregroundStyle(.secondary)
						}
						Spacer()
						VStack(alignment: .leading, spacing: 2) {
							Text("\(s.sessionsThisWeek)").font(.system(.title2, design: .rounded)).fontWeight(.bold)
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
