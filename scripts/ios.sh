#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Keep the machine's global xcode-select setting unchanged.
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
if [[ ! -x "$DEVELOPER_DIR/usr/bin/xcodebuild" ]]; then
  echo "Install full Xcode and iOS support, then open Xcode once." >&2
  exit 1
fi

action="${1:-open}"
shift || true
if [[ "$action" == core ]]; then
  exec swift test --package-path ios/FerryCore "$@"
fi
if ! command -v xcodegen >/dev/null; then
  echo "Install XcodeGen first: brew install xcodegen" >&2
  exit 1
fi
xcodegen generate --spec ios/project.yml
args=(-project ios/FerryBoard.xcodeproj -scheme FerryBoard -derivedDataPath ios/DerivedData)
case "$action" in
  generate) ;;
  open) open ios/FerryBoard.xcodeproj ;;
  build) xcodebuild "${args[@]}" -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO ARCHS=arm64 build "$@" ;;
  test)
    if [[ -z "${IOS_SIMULATOR_ID:-}" ]]; then
      IOS_SIMULATOR_ID=$(xcrun simctl list devices available -j | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next((v["udid"] for group in d["devices"].values() for v in group if v["name"] == "FerryBoard iPhone"), ""))')
      if [[ -z "$IOS_SIMULATOR_ID" ]]; then
        runtime=$(xcrun simctl list runtimes -j | python3 -c 'import json,sys; r=[x for x in json.load(sys.stdin)["runtimes"] if x.get("isAvailable") and ".iOS-" in x["identifier"]]; r.sort(key=lambda x:tuple(map(int,x["version"].split(".")))); print(r[-1]["identifier"] if r else "")')
        if [[ -z "$runtime" ]]; then
          echo "Download an iOS simulator first: xcodebuild -downloadPlatform iOS" >&2
          exit 1
        fi
        device_type=$(xcrun simctl list devicetypes -j | python3 -c 'import json,sys; d=[x for x in json.load(sys.stdin)["devicetypes"] if x["name"].startswith("iPhone")]; print(next((x["identifier"] for x in d if x["name"] == "iPhone 17e"),d[-1]["identifier"]))')
        IOS_SIMULATOR_ID=$(xcrun simctl create 'FerryBoard iPhone' "$device_type" "$runtime")
      fi
    fi
    xcodebuild "${args[@]}" -destination "platform=iOS Simulator,id=$IOS_SIMULATOR_ID" -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test "$@"
    ;;
  device)
    if [[ -z "${1:-}" ]]; then
      echo "Usage: scripts/ios.sh device IPHONE_UDID (from xcrun devicectl list devices)" >&2
      exit 1
    fi
    device_id="$1"; shift
    xcodebuild "${args[@]}" -destination "id=$device_id" -allowProvisioningUpdates -allowProvisioningDeviceRegistration build "$@"
    xcrun devicectl device install app --device "$device_id" ios/DerivedData/Build/Products/Debug-iphoneos/FerryBoard.app
    xcrun devicectl device process launch --device "$device_id" nyc.juliet.ferryboard
    ;;
  *) echo "Usage: scripts/ios.sh {open|generate|core|build|test|device IPHONE_UDID}" >&2; exit 1 ;;
esac
