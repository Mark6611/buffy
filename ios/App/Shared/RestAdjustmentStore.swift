import Foundation

// Written by the AddRestTime / SkipRest App Intents (which run in the widget
// extension's process, without opening the app, when tapped from the Dynamic
// Island / Lock Screen). Read once by the app on next foreground to reconcile
// its own rest-timer state with what the user did from outside the app.
// Presence of the file IS the "unconsumed" signal — the reader deletes it.
struct RestAdjustment: Codable {
	var endTimeMs: Double
	var skipped: Bool
}

enum RestAdjustmentStore {
	private static var url: URL? {
		FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: buffyAppGroupId)?
			.appendingPathComponent("rest-adjustment.json")
	}

	static func write(_ adj: RestAdjustment) {
		guard let url, let data = try? JSONEncoder().encode(adj) else { return }
		try? data.write(to: url, options: .atomic)
	}

	/// Read + delete in one call so a later read never double-applies the same event.
	static func consume() -> RestAdjustment? {
		guard let url, let data = try? Data(contentsOf: url) else { return nil }
		try? FileManager.default.removeItem(at: url)
		return try? JSONDecoder().decode(RestAdjustment.self, from: data)
	}
}
