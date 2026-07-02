import Capacitor
import Foundation
import HealthKit

// Writes finished workouts to Apple Health as traditional strength training,
// and (opt-in, separately) READS the recovery signals a wearable such as a
// Whoop strap deposits there: HRV (SDNN), resting heart rate, sleep, and
// in-workout heart-rate samples. Both directions are opt-in from Settings and
// trigger the standard iOS permission sheet on first use.
@objc(HealthPlugin)
public class HealthPlugin: CAPPlugin, CAPBridgedPlugin {
	public let identifier = "HealthPlugin"
	public let jsName = "Health"
	public let pluginMethods: [CAPPluginMethod] = [
		CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
		CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
		CAPPluginMethod(name: "writeWorkout", returnType: CAPPluginReturnPromise),
		CAPPluginMethod(name: "requestReadAuthorization", returnType: CAPPluginReturnPromise),
		CAPPluginMethod(name: "readRecoverySignals", returnType: CAPPluginReturnPromise),
		CAPPluginMethod(name: "readHeartRateSamples", returnType: CAPPluginReturnPromise)
	]

	private let store = HKHealthStore()

	private let hrvType = HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!
	private let rhrType = HKQuantityType.quantityType(forIdentifier: .restingHeartRate)!
	private let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
	private let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)!

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

	// ─────────────────────────────────────────────── recovery reads (opt-in)

	/// Ask for READ access to HRV / resting HR / heart rate / sleep. Note: iOS
	/// deliberately hides whether read access was granted — `granted` here only
	/// means the request flow completed; denied types simply return no samples.
	@objc func requestReadAuthorization(_ call: CAPPluginCall) {
		guard HKHealthStore.isHealthDataAvailable() else {
			call.resolve(["granted": false])
			return
		}
		let read: Set<HKObjectType> = [hrvType, rhrType, hrType, sleepType]
		store.requestAuthorization(toShare: [], read: read) { success, error in
			call.resolve(["granted": success, "error": error?.localizedDescription ?? NSNull()])
		}
	}

	/// Today's HRV + resting HR against their trailing-30-day baselines, plus last
	/// night's sleep hours. Every key is optional — a signal the wearable never
	/// wrote (or the user denied) is simply absent, and the JS score renormalises.
	@objc func readRecoverySignals(_ call: CAPPluginCall) {
		guard HKHealthStore.isHealthDataAvailable() else {
			call.resolve([:])
			return
		}
		let cal = Calendar.current
		let now = Date()
		let startOfToday = cal.startOfDay(for: now)
		let baselineStart = cal.date(byAdding: .day, value: -30, to: startOfToday)!
		// "Last night": 6pm yesterday → noon today. Capping the end (instead of
		// `now`) keeps an afternoon nap from retroactively inflating last night's
		// hours on an evening refresh.
		let sleepStart = cal.date(byAdding: .hour, value: -6, to: startOfToday)!
		let sleepEnd = min(now, cal.date(byAdding: .hour, value: 12, to: startOfToday)!)

		var out: [String: Any] = [:]
		let group = DispatchGroup()
		let lock = NSLock()
		func put(_ key: String, _ value: Double?) {
			guard let value else { return }
			lock.lock()
			out[key] = value
			lock.unlock()
		}

		func avg(_ type: HKQuantityType, _ from: Date, _ to: Date, _ unit: HKUnit, _ key: String) {
			group.enter()
			let pred = HKQuery.predicateForSamples(withStart: from, end: to, options: .strictStartDate)
			let q = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: pred, options: .discreteAverage) { _, stats, _ in
				put(key, stats?.averageQuantity()?.doubleValue(for: unit))
				group.leave()
			}
			store.execute(q)
		}

		// Baseline = mean of DAILY means, not of raw samples — otherwise a source
		// that writes many spot-checks a day (watch) outweighs one that writes a
		// single nightly value (Whoop), and the baseline stops representing the
		// overnight quantity today is compared against.
		func dailyMeanBaseline(_ type: HKQuantityType, _ unit: HKUnit, _ key: String) {
			group.enter()
			let pred = HKQuery.predicateForSamples(withStart: baselineStart, end: startOfToday, options: .strictStartDate)
			let q = HKStatisticsCollectionQuery(
				quantityType: type,
				quantitySamplePredicate: pred,
				options: .discreteAverage,
				anchorDate: baselineStart,
				intervalComponents: DateComponents(day: 1)
			)
			q.initialResultsHandler = { _, collection, _ in
				var days: [Double] = []
				collection?.enumerateStatistics(from: baselineStart, to: startOfToday) { stats, _ in
					if let v = stats.averageQuantity()?.doubleValue(for: unit) { days.append(v) }
				}
				put(key, days.isEmpty ? nil : days.reduce(0, +) / Double(days.count))
				group.leave()
			}
			store.execute(q)
		}

		let ms = HKUnit.secondUnit(with: .milli)
		let bpm = HKUnit.count().unitDivided(by: .minute())
		avg(hrvType, startOfToday, now, ms, "hrvMs")
		dailyMeanBaseline(hrvType, ms, "hrvBaselineMs")
		avg(rhrType, startOfToday, now, bpm, "restingHr")
		dailyMeanBaseline(rhrType, bpm, "restingHrBaseline")

		// Sleep: union the asleep intervals so overlapping samples from two sources
		// (e.g. Whoop + iPhone) don't double-count the same hour.
		group.enter()
		let sleepPred = HKQuery.predicateForSamples(withStart: sleepStart, end: sleepEnd, options: [])
		let sleepQ = HKSampleQuery(sampleType: sleepType, predicate: sleepPred, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
			defer { group.leave() }
			guard let samples = samples as? [HKCategorySample], !samples.isEmpty else { return }
			let asleepValues: Set<Int>
			if #available(iOS 16.0, *) {
				asleepValues = Set(HKCategoryValueSleepAnalysis.allAsleepValues.map { $0.rawValue })
			} else {
				asleepValues = [HKCategoryValueSleepAnalysis.asleep.rawValue]
			}
			// Clamp to the window: the overlap predicate returns samples whole, so an
			// unclamped afternoon-nap sample straddling 6pm would add hours that lie
			// outside "last night".
			let intervals = samples
				.filter { asleepValues.contains($0.value) }
				.map { (start: max($0.startDate, sleepStart), end: min($0.endDate, sleepEnd)) }
				.filter { $0.end > $0.start }
				.sorted { $0.start < $1.start }
			guard !intervals.isEmpty else { return }
			var total: TimeInterval = 0
			var curStart = intervals[0].start
			var curEnd = intervals[0].end
			for iv in intervals.dropFirst() {
				if iv.start <= curEnd {
					curEnd = max(curEnd, iv.end)
				} else {
					total += curEnd.timeIntervalSince(curStart)
					curStart = iv.start
					curEnd = iv.end
				}
			}
			total += curEnd.timeIntervalSince(curStart)
			put("sleepHours", total / 3600.0)
		}
		store.execute(sleepQ)

		group.notify(queue: .main) {
			call.resolve(out)
		}
	}

	/// Heart-rate samples inside [startTime, endTime] (epoch ms), ascending.
	/// Resolves { samplesJson: "[{bpm,atMs}]" } — JSON string for bridge parity
	/// with the CloudSync plugin.
	@objc func readHeartRateSamples(_ call: CAPPluginCall) {
		guard HKHealthStore.isHealthDataAvailable() else {
			call.resolve(["samplesJson": "[]"])
			return
		}
		guard let startMs = call.getDouble("startTime"), let endMs = call.getDouble("endTime") else {
			call.reject("startTime and endTime are required")
			return
		}
		guard endMs > startMs else {
			call.reject("endTime must be after startTime")
			return
		}
		let from = Date(timeIntervalSince1970: startMs / 1000.0)
		let to = Date(timeIntervalSince1970: endMs / 1000.0)
		let pred = HKQuery.predicateForSamples(withStart: from, end: to, options: [])
		let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
		let bpmUnit = HKUnit.count().unitDivided(by: .minute())
		// 5000 ≈ one sample/second for 83 minutes — far beyond any wearable's
		// written-to-Health cadence for a session, so nothing real is dropped.
		let q = HKSampleQuery(sampleType: hrType, predicate: pred, limit: 5000, sortDescriptors: [sort]) { _, samples, _ in
			let items: [[String: Double]] = (samples as? [HKQuantitySample])?.map {
				["bpm": $0.quantity.doubleValue(for: bpmUnit), "atMs": $0.startDate.timeIntervalSince1970 * 1000.0]
			} ?? []
			let encoded = (try? JSONSerialization.data(withJSONObject: items)).flatMap { String(data: $0, encoding: .utf8) }
			call.resolve(["samplesJson": encoded ?? "[]"])
		}
		store.execute(q)
	}
}
