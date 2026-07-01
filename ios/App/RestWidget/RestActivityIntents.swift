import ActivityKit
import AppIntents

// LiveActivityIntent runs in-process from a Dynamic Island / Lock Screen button
// tap — no app launch. It updates the Activity directly (so the countdown
// reflects the change immediately) and leaves a note in the App Group shared
// container for the app to reconcile its own timer state next time it's open.
@available(iOS 17.0, *)
struct AddRestTimeIntent: LiveActivityIntent {
	static var title: LocalizedStringResource = "Add 30 seconds"

	func perform() async throws -> some IntentResult {
		guard let activity = Activity<RestActivityAttributes>.activities.first else { return .result() }
		let newEnd = activity.content.state.endDate.addingTimeInterval(30)
		let newState = RestActivityAttributes.ContentState(
			startDate: activity.content.state.startDate,
			endDate: newEnd,
			label: activity.content.state.label
		)
		await activity.update(ActivityContent(state: newState, staleDate: newEnd.addingTimeInterval(120)))
		RestAdjustmentStore.write(RestAdjustment(endTimeMs: newEnd.timeIntervalSince1970 * 1000, skipped: false))
		return .result()
	}
}

@available(iOS 17.0, *)
struct SkipRestIntent: LiveActivityIntent {
	static var title: LocalizedStringResource = "Skip rest"

	func perform() async throws -> some IntentResult {
		if let activity = Activity<RestActivityAttributes>.activities.first {
			await activity.end(nil, dismissalPolicy: .immediate)
		}
		RestAdjustmentStore.write(RestAdjustment(endTimeMs: Date().timeIntervalSince1970 * 1000, skipped: true))
		return .result()
	}
}
