#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
if [[ -z "${JAVA_HOME:-}" && -x /usr/libexec/java_home ]]; then
	export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
fi
export ANDROID_HOME="$SDK"
ADB="$SDK/platform-tools/adb"
EMULATOR="$SDK/emulator/emulator"
AVDMANAGER="$SDK/cmdline-tools/latest/bin/avdmanager"
ACTION="${1:-help}"
[[ $# -eq 0 ]] || shift

gradle() {
	(cd "$ROOT/android" && ./gradlew --no-daemon "$@")
}

case "$ACTION" in
	doctor)
		java -version
		[[ -x "$ADB" && -x "$EMULATOR" && -x "$AVDMANAGER" ]] || {
			printf 'Android tools are missing under %s. No packages were installed.\n' "$SDK" >&2
			exit 1
		}
		"$ADB" version
		"$EMULATOR" -list-avds
		;;
	core) gradle :core:test "$@" ;;
	parity)
		OUT="$ROOT/artifacts/android/service-parity"
		mkdir -p "$OUT"
		node "$ROOT/scripts/build-ios-service-contract.mjs" "$OUT/fixtures" 2>&1 | tee "$OUT/generator.log"
		export FERRY_SERVICE_CONTRACT="$OUT/fixtures"
		gradle :core:test "$@" 2>&1 | tee "$OUT/gradle.log"
		;;
	build) gradle :core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleRelease "$@" ;;
	test)
		API="${FERRY_ANDROID_API:-31}"
		case "$API" in 31|36) ;; *) printf 'Use installed test API 31 or 36.\n' >&2; exit 1 ;; esac
		AVD="FerryBoard_API${API}"
		[[ -d "$SDK/system-images/android-$API/default/arm64-v8a" ]] || {
			printf 'Missing API %s ARM64 image; install it separately before testing.\n' "$API" >&2
			exit 1
		}
		STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
		OUT="$ROOT/artifacts/android/$STAMP-api$API"
		mkdir -p "$OUT"
		printf 'API=%s\nAVD=%s\nUTC=%s\n' "$API" "$AVD" "$STAMP" > "$OUT/environment.txt"
		git -C "$ROOT" rev-parse HEAD >> "$OUT/environment.txt"
		gradle :app:assembleDebug :app:assembleDebugAndroidTest "$@" 2>&1 | tee "$OUT/build.log"
		if ! "$EMULATOR" -list-avds | rg -qx "$AVD"; then
			printf 'no\n' | "$AVDMANAGER" create avd --name "$AVD" --package "system-images;android-$API;default;arm64-v8a" --device pixel_6 > "$OUT/avd-create.log" 2>&1
		fi
		SERIAL="${FERRY_ANDROID_SERIAL:-}"
		STARTED_PID=""
		cleanup() {
			if [[ -n "$STARTED_PID" && "${FERRY_KEEP_EMULATOR:-0}" != 1 ]]; then
				"$ADB" -s "$SERIAL" emu kill >/dev/null 2>&1 || kill "$STARTED_PID" 2>/dev/null || true
			fi
		}
		trap cleanup EXIT
		if [[ -n "$SERIAL" ]]; then
			[[ "$SERIAL" == emulator-* ]] || { printf 'Physical-device testing requires separate instructions.\n' >&2; exit 1; }
			NAME="$("$ADB" -s "$SERIAL" emu avd name | head -n 1 | tr -d '\r')"
			[[ "$NAME" == "$AVD" ]] || { printf 'Refusing a shared emulator: %s\n' "$NAME" >&2; exit 1; }
		else
			PORT=5554
			while "$ADB" devices | rg -q "^emulator-$PORT[[:space:]]" || lsof -n -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
				PORT=$((PORT + 2))
				[[ "$PORT" -le 5680 ]] || { printf 'No free emulator port.\n' >&2; exit 1; }
			done
			SERIAL="emulator-$PORT"
			"$EMULATOR" -avd "$AVD" -port "$PORT" -no-window -no-audio -no-snapshot -no-boot-anim -gpu swiftshader_indirect > "$OUT/emulator.log" 2>&1 &
			STARTED_PID=$!
		fi
		printf 'Waiting for %s (%s)\n' "$SERIAL" "$AVD"
		BOOTED=0
		for _ in $(seq 1 180); do
			if [[ "$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; then BOOTED=1; break; fi
			if [[ -n "$STARTED_PID" ]] && ! kill -0 "$STARTED_PID" 2>/dev/null; then break; fi
			sleep 1
		done
		[[ "$BOOTED" == 1 ]] || { printf 'Emulator did not boot; see %s/emulator.log\n' "$OUT" >&2; exit 1; }
		"$ADB" -s "$SERIAL" shell input keyevent KEYCODE_WAKEUP
		"$ADB" -s "$SERIAL" shell wm dismiss-keyguard
		"$ADB" -s "$SERIAL" shell settings put global window_animation_scale 0
		"$ADB" -s "$SERIAL" shell settings put global transition_animation_scale 0
		"$ADB" -s "$SERIAL" shell settings put global animator_duration_scale 0
		"$ADB" -s "$SERIAL" install -r "$ROOT/android/app/build/outputs/apk/debug/app-debug.apk" | tee "$OUT/install.log"
		"$ADB" -s "$SERIAL" install -r "$ROOT/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk" | tee -a "$OUT/install.log"
		shasum -a 256 "$ROOT/android/app/build/outputs/apk/debug/app-debug.apk" "$ROOT/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk" > "$OUT/apk-sha256.txt"
		"$ADB" -s "$SERIAL" shell dumpsys window > "$OUT/preflight-windows.txt"
		"$ADB" -s "$SERIAL" exec-out screencap -p > "$OUT/preflight.png"
		if rg -q 'mCurrentFocus=.*Application (Not Responding|Error):' "$OUT/preflight-windows.txt"; then
			printf 'The emulator has an error dialog. Restart the dedicated AVD before testing; see %s/preflight.png\n' "$OUT" >&2
			exit 1
		fi
		"$ADB" -s "$SERIAL" logcat -c
		INSTRUMENT_ARGS=(-w -r -e ferryEvidenceRun "$STAMP-api$API")
		if [[ -n "${FERRY_ANDROID_TEST_CLASS:-}" ]]; then INSTRUMENT_ARGS+=(-e class "$FERRY_ANDROID_TEST_CLASS"); fi
		INSTRUMENT_ARGS+=(nyc.juliet.ferryboard.test/androidx.test.runner.AndroidJUnitRunner)
		{ printf 'adb -s %q shell am instrument ' "$SERIAL"; printf '%q ' "${INSTRUMENT_ARGS[@]}"; printf '\n'; } > "$OUT/command.txt"
		"$ADB" -s "$SERIAL" shell am instrument "${INSTRUMENT_ARGS[@]}" 2>&1 | tee "$OUT/instrumentation.log"
		"$ADB" -s "$SERIAL" logcat -d > "$OUT/logcat.txt"
		"$ADB" -s "$SERIAL" pull "/sdcard/Android/data/nyc.juliet.ferryboard/files/screenshots/$STAMP-api$API" "$OUT/screenshots" > "$OUT/screenshots-pull.log" 2>&1 || true
		printf 'Verification artifacts: %s\n' "$OUT"
		if ! rg -q 'OK \([0-9]+ tests?\)' "$OUT/instrumentation.log" || rg -q 'FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed' "$OUT/instrumentation.log"; then
			exit 1
		fi
		;;
	*)
		printf 'Usage: scripts/android.sh doctor|core|parity|build|test [Gradle arguments]\n'
		printf 'Test API: FERRY_ANDROID_API=31 or 36. Tests use only a dedicated FerryBoard emulator.\n'
		;;
esac
