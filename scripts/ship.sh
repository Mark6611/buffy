#!/usr/bin/env bash
# Ship Buffy to TestFlight — the ONE pipeline, every gate checked.
#
#   scripts/ship.sh [build-number] [--dry-run]
#
# No build number → current CURRENT_PROJECT_VERSION + 1.
# --dry-run runs everything up to and including the entitlement check, then stops
# (no upload, no version left bumped? — the bump IS applied; rerun without the flag
# to ship the same number).
#
# Why each unusual step exists (learned the hard way — see CLAUDE.md):
#  * gates are never piped: `test | tail` reads tail's exit code and once shipped a
#    build whose E2E suite was failing
#  * the archive must be SIGNED (manual profiles): automatic signing can't archive
#    headlessly here, and an unsigned archive silently strips every entitlement
#  * entitlements are verified INSIDE the signed binary before upload
#  * an uploaded build is INVISIBLE on the phone until assigned to the tester group
set -euo pipefail
cd "$(dirname "$0")/.."

ASC_KEY_ID="DUPV266J6S"
ASC_ISSUER="b0021702-5324-4cc1-9ddd-66a5a1535fe6"
ASC_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
APP_ID="6785999682"
GROUP_ID="6e20b93c-fccb-46bd-be23-aaed076ea271"
ARCHIVE=/tmp/buffy-archive/Buffy.xcarchive
EXPORT=/tmp/buffy-export

DRY_RUN=0
BUILD_NUM=""
for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY_RUN=1 ;;
		*) BUILD_NUM="$arg" ;;
	esac
done

[ -f "$ASC_KEY_PATH" ] || { echo "FATAL: ASC key missing at $ASC_KEY_PATH"; exit 1; }

echo "══ Gate 1/3: unit tests"
npm test
echo "══ Gate 2/3: svelte-check"
npm run check
echo "══ Gate 3/3: E2E"
npm run test:e2e

echo "══ Version bump"
BUILD_NUM=$(ruby -e '
require "xcodeproj"
proj = Xcodeproj::Project.open("ios/App/App.xcodeproj")
app = proj.targets.find { |t| t.name == "App" }
current = app.build_configurations.first.build_settings["CURRENT_PROJECT_VERSION"].to_i
n = ARGV[0].to_s.empty? ? current + 1 : ARGV[0].to_i
proj.targets.each do |t|
  next unless ["App", "RestWidget"].include?(t.name)
  t.build_configurations.each { |c| c.build_settings["CURRENT_PROJECT_VERSION"] = n.to_s }
end
proj.save
puts n' "$BUILD_NUM")
echo "   building 1.0 ($BUILD_NUM)"

echo "══ Web bundle + native sync"
npm run ios:sync > /tmp/ship-iossync.log 2>&1

echo "══ Signed archive"
rm -rf "$(dirname "$ARCHIVE")" "$EXPORT"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
	-destination 'generic/platform=iOS' -archivePath "$ARCHIVE" archive \
	> /tmp/ship-archive.log 2>&1 || { tail -30 /tmp/ship-archive.log; exit 1; }

echo "══ Export"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$EXPORT" \
	-exportOptionsPlist ios/ExportOptions.plist \
	> /tmp/ship-export.log 2>&1 || { tail -30 /tmp/ship-export.log; exit 1; }

echo "══ Entitlement verification (the build-5 lesson)"
rm -rf /tmp/ship-ipa && mkdir /tmp/ship-ipa
unzip -q "$EXPORT/App.ipa" -d /tmp/ship-ipa
ENT=$(codesign -d --entitlements :- /tmp/ship-ipa/Payload/App.app 2>/dev/null | tr '<' '\n<')
for needle in icloud-container-identifiers application-groups developer.healthkit; do
	echo "$ENT" | grep -q "$needle" || { echo "FATAL: entitlement '$needle' missing from signed binary — DO NOT ship"; exit 1; }
done
VERS=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" /tmp/ship-ipa/Payload/App.app/Info.plist)
[ "$VERS" = "$BUILD_NUM" ] || { echo "FATAL: IPA says build $VERS, expected $BUILD_NUM"; exit 1; }
echo "   entitlements + version OK"

if [ "$DRY_RUN" = "1" ]; then
	echo "── dry run: stopping before upload. IPA at $EXPORT/App.ipa (build $BUILD_NUM)"
	exit 0
fi

echo "══ Upload"
xcrun altool --upload-app -f "$EXPORT/App.ipa" --type ios \
	--apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER" > /tmp/ship-upload.log 2>&1 \
	|| { tail -10 /tmp/ship-upload.log; exit 1; }
grep -q "UPLOAD SUCCEEDED" /tmp/ship-upload.log || { tail -10 /tmp/ship-upload.log; exit 1; }

echo "══ Waiting for Apple processing, then assigning to the tester group"
python3 - "$BUILD_NUM" <<'PYEOF'
import jwt, time, json, sys, urllib.request, urllib.error
BUILD = sys.argv[1]
KEY_ID, ISSUER = "DUPV266J6S", "b0021702-5324-4cc1-9ddd-66a5a1535fe6"
KEY = open(f"{__import__('os').path.expanduser('~')}/.appstoreconnect/private_keys/AuthKey_{KEY_ID}.p8").read()
APP, GROUP = "6785999682", "6e20b93c-fccb-46bd-be23-aaed076ea271"
def api(method, path, body=None):
    now = int(time.time())
    tok = jwt.encode({"iss": ISSUER, "iat": now, "exp": now + 900, "aud": "appstoreconnect-v1"},
                     KEY, algorithm="ES256", headers={"kid": KEY_ID, "typ": "JWT"})
    req = urllib.request.Request("https://api.appstoreconnect.apple.com" + path,
                                 data=json.dumps(body).encode() if body else None, method=method)
    req.add_header("Authorization", "Bearer " + tok); req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode()
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")
deadline = time.time() + 30 * 60
build_id = None
while time.time() < deadline:
    st, b = api("GET", f"/v1/builds?filter[app]={APP}&filter[version]={BUILD}")
    recs = b.get("data", [])
    if recs and recs[0]["attributes"]["processingState"] == "VALID":
        build_id = recs[0]["id"]; break
    print("   waiting…", recs[0]["attributes"]["processingState"] if recs else "not visible yet", flush=True)
    time.sleep(60)
if not build_id:
    raise SystemExit("build never reached VALID in 30 min — check App Store Connect")
st, _ = api("POST", f"/v1/betaGroups/{GROUP}/relationships/builds", {"data": [{"type": "builds", "id": build_id}]})
assert st in (200, 204), f"group assignment failed: HTTP {st}"
st, d = api("GET", f"/v1/builds/{build_id}/buildBetaDetail")
state = d["data"]["attributes"]["internalBuildState"]
assert state == "IN_BETA_TESTING", f"unexpected state {state}"
print(f"   ✓ build {BUILD} is IN_BETA_TESTING — TestFlight will notify the phone")
PYEOF

echo "══ DONE: 1.0 ($BUILD_NUM) shipped and assigned. Remember: commit the version bump."
