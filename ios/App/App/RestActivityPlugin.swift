import ActivityKit
import Capacitor
import Foundation

// Bridges the JS workout store to an ActivityKit Live Activity so the rest
// countdown shows on the Lock Screen + Dynamic Island when the app is in the
// background. JS calls: RestActivity.start({startTime,endTime,label}) / end().
@objc(RestActivityPlugin)
public class RestActivityPlugin: CAPPlugin, CAPBridgedPlugin {
	public let identifier = "RestActivityPlugin"
	public let jsName = "RestActivity"
	public let pluginMethods: [CAPPluginMethod] = [
		CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
		CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
		CAPPluginMethod(name: "readPendingAdjustment", returnType: CAPPluginReturnPromise)
	]

	@objc func start(_ call: CAPPluginCall) {
		guard #available(iOS 16.2, *) else { call.resolve(); return }
		guard ActivityAuthorizationInfo().areActivitiesEnabled else { call.resolve(); return }
		let startMs = call.getDouble("startTime") ?? (Date().timeIntervalSince1970 * 1000)
		let endMs = call.getDouble("endTime") ?? 0
		let label = call.getString("label") ?? "Rest"
		let startDate = Date(timeIntervalSince1970: startMs / 1000.0)
		let endDate = Date(timeIntervalSince1970: endMs / 1000.0)
		guard endDate > Date() else { call.resolve(); return }

		// Snapshot the stale activities BEFORE requesting the new one. endAllActivities'
		// fire-and-forget Task enumerates .activities at some later point on another
		// executor — if that snapshot happened after the request registered, it would
		// end the activity we just started (the countdown flashes and vanishes).
		let stale = Activity<RestActivityAttributes>.activities
		let state = RestActivityAttributes.ContentState(startDate: startDate, endDate: endDate, label: label)
		do {
			_ = try Activity.request(
				attributes: RestActivityAttributes(),
				content: .init(state: state, staleDate: endDate.addingTimeInterval(120)),
				pushType: nil
			)
			Task {
				for activity in stale {
					await activity.end(nil, dismissalPolicy: .immediate)
				}
			}
			call.resolve()
		} catch {
			call.reject("Live Activity start failed: \(error.localizedDescription)")
		}
	}

	@objc func end(_ call: CAPPluginCall) {
		RestActivityPlugin.endAllActivities()
		call.resolve()
	}

	/// Consumes (reads + clears) an add-time/skip event left by a Live Activity
	/// button tap while the app was backgrounded, so the JS timer can reconcile.
	@objc func readPendingAdjustment(_ call: CAPPluginCall) {
		guard let adj = RestAdjustmentStore.consume() else {
			call.resolve(["present": false])
			return
		}
		call.resolve(["present": true, "endTimeMs": adj.endTimeMs, "skipped": adj.skipped])
	}

	static func endAllActivities() {
		guard #available(iOS 16.2, *) else { return }
		Task {
			for activity in Activity<RestActivityAttributes>.activities {
				await activity.end(nil, dismissalPolicy: .immediate)
			}
		}
	}
}
