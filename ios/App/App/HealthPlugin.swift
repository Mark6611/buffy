import Capacitor
import Foundation
import HealthKit

// Writes finished workouts to Apple Health as traditional strength training.
// Opt-in from Settings; the first write triggers the standard iOS permission
// sheet. Read access isn't requested — Buffy only ever writes.
@objc(HealthPlugin)
public class HealthPlugin: CAPPlugin, CAPBridgedPlugin {
	public let identifier = "HealthPlugin"
	public let jsName = "Health"
	public let pluginMethods: [CAPPluginMethod] = [
		CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
		CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
		CAPPluginMethod(name: "writeWorkout", returnType: CAPPluginReturnPromise)
	]

	private let store = HKHealthStore()

	@objc func isAvailable(_ call: CAPPluginCall) {
		call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
	}

	@objc func requestAuthorization(_ call: CAPPluginCall) {
		guard HKHealthStore.isHealthDataAvailable() else {
			call.resolve(["granted": false])
			return
		}
		let toShare: Set<HKSampleType> = [HKObjectType.workoutType()]
		store.requestAuthorization(toShare: toShare, read: []) { success, error in
			call.resolve(["granted": success, "error": error?.localizedDescription ?? NSNull()])
		}
	}

	@objc func writeWorkout(_ call: CAPPluginCall) {
		guard HKHealthStore.isHealthDataAvailable() else {
			call.reject("Health not available on this device")
			return
		}
		guard let startMs = call.getDouble("startTime"), let endMs = call.getDouble("endTime") else {
			call.reject("startTime and endTime are required")
			return
		}
		let start = Date(timeIntervalSince1970: startMs / 1000.0)
		let end = Date(timeIntervalSince1970: endMs / 1000.0)
		guard end > start else {
			call.reject("endTime must be after startTime")
			return
		}

		// HKWorkoutBuilder — the HKWorkout(activityType:start:end:) initializer is
		// deprecated as of iOS 17; the builder is the supported write path.
		func save() {
			let config = HKWorkoutConfiguration()
			config.activityType = .traditionalStrengthTraining
			let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: .local())
			builder.beginCollection(withStart: start) { began, error in
				guard began else {
					call.reject(error?.localizedDescription ?? "Failed to begin workout collection")
					return
				}
				builder.endCollection(withEnd: end) { ended, error in
					guard ended else {
						call.reject(error?.localizedDescription ?? "Failed to end workout collection")
						return
					}
					builder.finishWorkout { workout, error in
						if workout != nil {
							call.resolve()
						} else {
							call.reject(error?.localizedDescription ?? "Failed to save workout")
						}
					}
				}
			}
		}

		// requestAuthorization is safe to call again (no-op if already decided); this
		// covers a fresh call.resolve() timing race with the very first toggle-on.
		let toShare: Set<HKSampleType> = [HKObjectType.workoutType()]
		store.requestAuthorization(toShare: toShare, read: []) { _, _ in
			DispatchQueue.main.async { save() }
		}
	}
}
