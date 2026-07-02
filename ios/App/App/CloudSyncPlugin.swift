import Capacitor
import CloudKit
import Foundation

// Syncs Buffy's data via CloudKit's private database (the signed-in iCloud
// account — no separate login, no server we run). Each entity (Exercise,
// Template, WorkoutSession) is stored as one CKRecord: id + updatedAt + the
// entity's full JSON. Mapping every nested field into CloudKit's own schema
// would multiply the surface area for no real benefit — JS already owns the
// data shape and the last-write-wins merge, so CloudKit just needs to move
// opaque blobs around reliably.
//
// Parameters cross the bridge as JSON strings (not nested arrays-of-objects)
// to keep this file using only the plain getString/getArray primitives that
// are stable across Capacitor versions.
@objc(CloudSyncPlugin)
public class CloudSyncPlugin: CAPPlugin, CAPBridgedPlugin {
	public let identifier = "CloudSyncPlugin"
	public let jsName = "CloudSync"
	public let pluginMethods: [CAPPluginMethod] = [
		CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
		CAPPluginMethod(name: "pull", returnType: CAPPluginReturnPromise),
		CAPPluginMethod(name: "push", returnType: CAPPluginReturnPromise)
	]

	// CKContainer.default() validates the iCloud entitlement *synchronously in its
	// initializer*, and when that entitlement is absent from the signed build it
	// raises an Objective-C NSException (CKException) — not a Swift error, so no
	// Swift do/catch can contain it; it aborts the process with SIGABRT. Our store
	// build is currently signed by a profile that carries no iCloud entitlement (the
	// App ID isn't provisioned for CloudKit yet), so constructing the container at
	// all would crash the app the instant the user taps the sync toggle.
	//
	// CloudSyncSafeContainer wraps that construction in an Objective-C @try/@catch
	// (the only language that can catch an NSException) and returns nil on failure.
	// When nil, `container`/`db` stay nil and every method below degrades to a clean
	// "unavailable" instead of crashing. Once the App ID is provisioned and a new
	// profile is issued, construction succeeds and sync lights up unchanged. Kept
	// lazy so merely registering the plugin at launch never touches CloudKit.
	private lazy var container: CKContainer? = Self.makeContainerSafely()
	private var db: CKDatabase? { container?.privateCloudDatabase }

	private static func makeContainerSafely() -> CKContainer? {
		CloudSyncSafeContainer.defaultContainer()
	}

	@objc func isAvailable(_ call: CAPPluginCall) {
		guard let container else {
			// No iCloud entitlement in this build — report unavailable, never crash.
			call.resolve(["available": false])
			return
		}
		container.accountStatus { status, _ in
			call.resolve(["available": status == .available])
		}
	}

	/// Fetch every record of `type`. Resolves { recordsJson: "[{id,updatedAt,json}]" }.
	@objc func pull(_ call: CAPPluginCall) {
		guard let db else {
			call.reject("iCloud is not available in this build")
			return
		}
		guard let type = call.getString("type") else {
			call.reject("type is required")
			return
		}
		var results: [[String: String]] = []
		let op = CKQueryOperation(query: CKQuery(recordType: type, predicate: NSPredicate(value: true)))
		op.recordMatchedBlock = { recordID, result in
			if case .success(let record) = result {
				results.append([
					"id": recordID.recordName,
					"updatedAt": (record["updatedAt"] as? String) ?? "",
					"json": (record["json"] as? String) ?? ""
				])
			}
		}
		op.queryResultBlock = { result in
			switch result {
			case .success:
				let encoded = (try? JSONSerialization.data(withJSONObject: results)).flatMap { String(data: $0, encoding: .utf8) }
				call.resolve(["recordsJson": encoded ?? "[]"])
			case .failure(let error):
				// CKError.unknownItem on a brand-new record TYPE (schema not created
				// yet server-side) is normal on first-ever sync — treat as "empty".
				if (error as? CKError)?.code == .unknownItem {
					call.resolve(["recordsJson": "[]"])
				} else {
					call.reject("CloudKit pull failed: \(error.localizedDescription)")
				}
			}
		}
		db.add(op)
	}

	/// Upsert records of `type`. `recordsJson` is "[{id,updatedAt,json}]".
	/// Last-write-wins is already resolved on the JS side before this is called, so
	/// this always overwrites the server copy (.allKeys) rather than diffing.
	@objc func push(_ call: CAPPluginCall) {
		guard let db else {
			call.reject("iCloud is not available in this build")
			return
		}
		guard let type = call.getString("type"), let recordsJson = call.getString("recordsJson") else {
			call.reject("type and recordsJson are required")
			return
		}
		guard let data = recordsJson.data(using: .utf8),
			let items = (try? JSONSerialization.jsonObject(with: data)) as? [[String: String]]
		else {
			call.reject("recordsJson was not valid JSON")
			return
		}
		guard !items.isEmpty else {
			call.resolve()
			return
		}
		let ckRecords: [CKRecord] = items.compactMap { item in
			guard let id = item["id"] else { return nil }
			let record = CKRecord(recordType: type, recordID: CKRecord.ID(recordName: id))
			record["updatedAt"] = item["updatedAt"] as CKRecordValue?
			record["json"] = item["json"] as CKRecordValue?
			return record
		}
		let op = CKModifyRecordsOperation(recordsToSave: ckRecords, recordIDsToDelete: nil)
		op.savePolicy = .allKeys
		op.modifyRecordsResultBlock = { result in
			switch result {
			case .success:
				call.resolve()
			case .failure(let error):
				call.reject("CloudKit push failed: \(error.localizedDescription)")
			}
		}
		db.add(op)
	}
}
