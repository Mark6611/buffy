import ActivityKit
import Foundation

// Shared between the app (which starts/ends the activity) and the widget
// extension (which renders it). Lives in both targets.
struct RestActivityAttributes: ActivityAttributes {
	public struct ContentState: Codable, Hashable {
		var startDate: Date
		var endDate: Date
		var label: String
	}
}
