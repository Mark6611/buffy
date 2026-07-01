import Foundation

// Shared between the app (writer) and the widget extension (reader) via an
// App Group container — WidgetKit runs the widget in its own process, so this
// is the only way for it to see live data without the app being open.
let buffyAppGroupId = "group.com.mark.buffy"
private let widgetSnapshotFilename = "widget-snapshot.json"

struct WidgetSnapshot: Codable {
	var streakDays: Int
	var volumeThisWeekKg: Double
	var sessionsThisWeek: Int
	var nextOrLastTitle: String
	var isNext: Bool
	var updatedAt: String
}

enum WidgetSnapshotStore {
	static func read() -> WidgetSnapshot? {
		guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: buffyAppGroupId),
			let data = try? Data(contentsOf: container.appendingPathComponent(widgetSnapshotFilename))
		else { return nil }
		return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
	}
}
