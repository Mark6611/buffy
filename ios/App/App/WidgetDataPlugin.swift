import Capacitor
import Foundation
import WidgetKit

// Bridges the JS analytics summary into the shared App Group container so the
// home-screen widget (a separate process) can read it, and asks WidgetKit to
// refresh its timeline. JS calls: WidgetData.write({streakDays, volumeThisWeekKg,
// sessionsThisWeek, nextOrLastTitle, isNext}).
@objc(WidgetDataPlugin)
public class WidgetDataPlugin: CAPPlugin, CAPBridgedPlugin {
	public let identifier = "WidgetDataPlugin"
	public let jsName = "WidgetData"
	public let pluginMethods: [CAPPluginMethod] = [
		CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise)
	]

	@objc func write(_ call: CAPPluginCall) {
		guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: buffyAppGroupId) else {
			call.resolve()
			return
		}
		let snapshot = WidgetSnapshot(
			streakDays: call.getInt("streakDays") ?? 0,
			volumeThisWeekKg: call.getDouble("volumeThisWeekKg") ?? 0,
			sessionsThisWeek: call.getInt("sessionsThisWeek") ?? 0,
			nextOrLastTitle: call.getString("nextOrLastTitle") ?? "",
			isNext: call.getBool("isNext") ?? false,
			updatedAt: ISO8601DateFormatter().string(from: Date())
		)
		guard let data = try? JSONEncoder().encode(snapshot) else {
			call.resolve()
			return
		}
		try? data.write(to: container.appendingPathComponent("widget-snapshot.json"), options: .atomic)
		if #available(iOS 14.0, *) {
			WidgetCenter.shared.reloadAllTimelines()
		}
		call.resolve()
	}
}
