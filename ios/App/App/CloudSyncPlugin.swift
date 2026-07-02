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
// Records live in ONE CUSTOM ZONE PER TYPE (zone name == record type), and
// pull uses CKFetchRecordZoneChangesOperation rather than CKQuery. Why:
//  - CKQuery with TRUEPREDICATE requires a "recordName is queryable" index
//    that CloudKit's just-in-time schema never creates — queries would fail
//    from the second sync onward unless someone hand-edits the Dashboard.
//    Zone fetches need no index at all.
//  - Zone fetches paginate via moreComing/continuation tokens, so a long
//    history can't be silently truncated the way an uncursored query is.
//  - Custom zones are the prerequisite for real delta sync later (persist the
//    change token instead of passing nil).
// Deletions are app-level tombstones inside the JSON (deletedAt), synced like
// any other edit — CloudKit-level record deletes are never issued.
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

	// CloudKit hard-caps a modify operation at 400 records; stay well under it
	// (Apple's guidance on limitExceeded is "split and retry" — we just never
	// build an oversized batch in the first place).
	private static let pushChunkSize = 200

	// CKContainer.default() validates the iCloud entitlement *synchronously in its
	// initializer*, and when that entitlement is absent from the signed build it
	// raises an Objective-C NSException (CKException) — not a Swift error, so no
	// Swift do/catch can contain it; it aborts the process with SIGABRT. That is
	// exactly the state of a build whose profile wasn't provisioned for CloudKit.
	//
	// CloudSyncSafeContainer wraps the construction in an Objective-C @try/@catch
	// (the only language that can catch an NSException) and returns nil on failure.
	// When nil, `container`/`db` stay nil and every method below degrades to a
	// clean "unavailable" instead of crashing. Kept lazy so merely registering the
	// plugin at launch never touches CloudKit.
	private lazy var container: CKContainer? = CloudSyncSafeContainer.defaultContainer()
	private var db: CKDatabase? { container?.privateCloudDatabase }

	private func zoneID(for type: String) -> CKRecordZone.ID {
		CKRecordZone.ID(zoneName: type, ownerName: CKCurrentUserDefaultName)
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

	/// Fetch every record of `type` (full snapshot: nil change token, chaining
	/// moreComing pages). Resolves { recordsJson: "[{id,updatedAt,json}]" }.
	@objc func pull(_ call: CAPPluginCall) {
		guard let db else {
			call.reject("iCloud is not available in this build")
			return
		}
		guard let type = call.getString("type") else {
			call.reject("type is required")
			return
		}
		let zone = zoneID(for: type)
		var results: [[String: String]] = []
		var finished = false // guard against resolve/reject firing twice

		func finishSuccess() {
			guard !finished else { return }
			finished = true
			let encoded = (try? JSONSerialization.data(withJSONObject: results)).flatMap { String(data: $0, encoding: .utf8) }
			call.resolve(["recordsJson": encoded ?? "[]"])
		}
		func finishFailure(_ error: Error) {
			guard !finished else { return }
			finished = true
			// A zone that doesn't exist yet just means nothing was ever pushed from
			// any device — an empty cloud, not an error.
			if let ck = error as? CKError, ck.code == .zoneNotFound || ck.code == .userDeletedZone {
				call.resolve(["recordsJson": "[]"])
			} else {
				call.reject("CloudKit pull failed: \(error.localizedDescription)")
			}
		}

		func fetchPage(_ token: CKServerChangeToken?) {
			let config = CKFetchRecordZoneChangesOperation.ZoneConfiguration()
			config.previousServerChangeToken = token
			let op = CKFetchRecordZoneChangesOperation(recordZoneIDs: [zone], configurationsByRecordZoneID: [zone: config])
			op.recordWasChangedBlock = { recordID, result in
				if case .success(let record) = result {
					results.append([
						"id": recordID.recordName,
						"updatedAt": (record["updatedAt"] as? String) ?? "",
						"json": (record["json"] as? String) ?? ""
					])
				}
			}
			op.recordZoneFetchResultBlock = { _, result in
				switch result {
				case .success(let (serverToken, _, moreComing)):
					if moreComing {
						fetchPage(serverToken)
					} else {
						finishSuccess()
					}
				case .failure(let error):
					finishFailure(error)
				}
			}
			op.fetchRecordZoneChangesResultBlock = { result in
				if case .failure(let error) = result {
					finishFailure(error)
				}
			}
			db.add(op)
		}
		fetchPage(nil)
	}

	/// Upsert records of `type`. `recordsJson` is "[{id,updatedAt,json}]".
	/// Last-write-wins is already resolved on the JS side before this is called, so
	/// this always overwrites the server copy (.allKeys) rather than diffing.
	/// The zone is (re)saved first — idempotent, and cheaper than getting a
	/// zone-existence cache right across CloudKit's arbitrary callback queues.
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
		let zone = zoneID(for: type)
		let ckRecords: [CKRecord] = items.compactMap { item in
			guard let id = item["id"] else { return nil }
			let record = CKRecord(recordType: type, recordID: CKRecord.ID(recordName: id, zoneID: zone))
			record["updatedAt"] = item["updatedAt"] as CKRecordValue?
			record["json"] = item["json"] as CKRecordValue?
			return record
		}
		let chunks = stride(from: 0, to: ckRecords.count, by: Self.pushChunkSize).map {
			Array(ckRecords[$0..<min($0 + Self.pushChunkSize, ckRecords.count)])
		}

		// Sequential: chunk N+1 only starts after chunk N saved, first failure rejects.
		func pushChunk(_ index: Int) {
			guard index < chunks.count else {
				call.resolve()
				return
			}
			let op = CKModifyRecordsOperation(recordsToSave: chunks[index], recordIDsToDelete: nil)
			op.savePolicy = .allKeys
			op.modifyRecordsResultBlock = { result in
				switch result {
				case .success:
					pushChunk(index + 1)
				case .failure(let error):
					call.reject("CloudKit push failed: \(error.localizedDescription)")
				}
			}
			db.add(op)
		}

		let ensureZone = CKModifyRecordZonesOperation(recordZonesToSave: [CKRecordZone(zoneID: zone)], recordZoneIDsToDelete: nil)
		ensureZone.modifyRecordZonesResultBlock = { result in
			switch result {
			case .success:
				pushChunk(0)
			case .failure(let error):
				call.reject("CloudKit zone setup failed: \(error.localizedDescription)")
			}
		}
		db.add(ensureZone)
	}
}
