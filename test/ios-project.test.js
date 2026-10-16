import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
const exists = path => access(new URL(path, root));
const project = () => read("ios/project.yml");
const installedBundleID = "nyc.juliet.ferryboard";
const keychainGroup = "$(AppIdentifierPrefix)nyc.juliet.ferryboard.widgets";

function plistString(plist, key) {
	return plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1];
}

test("Ferry Kitty project targets, sources and scheme resolve after the native rename", async () => {
	const spec = await project();
	assert.match(spec, /^name: FerryKitty$/m);
	for (const target of ["FerryKitty", "FerryKittyWidget", "FerryKittyTests", "FerryKittyUITests"]) {
		assert.match(spec, new RegExp(`^  ${target}:$`, "m"));
		await exists(`ios/${target}/`);
	}
	for (const [, path] of spec.matchAll(/^\s+(?:- )?path: (\S+)$/gm)) await exists(`ios/${path}`);
	for (const [, path] of spec.matchAll(/^\s+sources: \[(\S+)\]$/gm)) await exists(`ios/${path}`);
	assert.match(spec, /schemes:\n  FerryKitty:\n/);
	assert.doesNotMatch(spec, /FerryBoard/);
	assert.match(await read("ios/FerryKitty/FerryKittyApp.swift"), /@main\s+struct FerryKittyApp: App/);
	assert.match(await read("ios/FerryKittyWidget/FerryKittyWidget.swift"), /@main\s+struct FerryKittyWidget: Widget/);
	for (const file of await readdir(new URL("ios/FerryKittyTests/", root))) {
		if (file.endsWith(".swift")) assert.doesNotMatch(await read(`ios/FerryKittyTests/${file}`), /import FerryBoard/);
	}
	assert.match(await read("ios/FerryKittyUITests/FerryKittyUITests.swift"), /class FerryKittyUITests: XCTestCase/);
});

test("native helper and fixture generator use the renamed project and build products", async () => {
	const helper = await read("scripts/ios.sh");
	assert.match(helper, /-project ios\/FerryKitty\.xcodeproj -scheme FerryKitty/);
	assert.match(helper, /open ios\/FerryKitty\.xcodeproj/);
	assert.match(helper, /device install app .*Debug-iphoneos\/FerryKitty\.app/);
	assert.match(helper, /device process launch .*nyc\.juliet\.ferryboard/);
	assert.match(helper, /simctl create 'FerryKitty iPhone'/);
	assert.doesNotMatch(helper, /FerryBoard/);
	const fixtures = await read("scripts/build-ios-fixtures.mjs");
	const output = fixtures.match(/const output = new URL\('([^']+)'/)[1];
	assert.equal(output, "../ios/FerryKitty/PreviewData/");
	await access(new URL(output, new URL("scripts/build-ios-fixtures.mjs", root)));
	const changelog = JSON.parse(await read("ios/FerryKitty/PreviewData/changelog.json"));
	assert.equal(changelog.entries[0].title, "Ferry Kitty");
	assert.match(fixtures, /title: 'Ferry Kitty'/);
});

test("app and widget display names agree with the XcodeGen source of truth", async () => {
	const spec = await project();
	const app = await read("ios/Config/Info.plist");
	const widget = await read("ios/Config/Widget-Info.plist");
	assert.equal(plistString(app, "CFBundleDisplayName"), "Ferry Kitty");
	assert.equal(plistString(widget, "CFBundleDisplayName"), "Ferry Kitty");
	assert.equal((spec.match(/CFBundleDisplayName: Ferry Kitty$/gm) ?? []).length, 2);
	assert.match(plistString(app, "NSLocationWhenInUseUsageDescription"), /Ferry Kitty widget/);
	assert.match(plistString(app, "NSLocalNetworkUsageDescription"), /Ferry Kitty test server/);
	const visibleSources = ["ios/FerryKitty/Sheets.swift", "ios/FerryKitty/FerryStore.swift", "ios/FerryKitty/WidgetSetupView.swift",
		"ios/FerryKittyWidget/NearbyProvider.swift", "ios/FerryKittyWidget/WidgetConfiguration.swift", "ios/FerryCore/Sources/FerryCore/FerryRepository.swift"];
	for (const path of visibleSources) {
		const source = await read(path);
		assert.doesNotMatch(source, /Ferry Board/);
		assert.match(source, /Ferry Kitty/);
	}
});

test("native rename preserves installed identity, shared settings and widget continuity", async () => {
	const spec = await project();
	const identifiers = [...spec.matchAll(/PRODUCT_BUNDLE_IDENTIFIER: (\S+)/g)].map(match => match[1]);
	assert.deepEqual(identifiers, [installedBundleID, `${installedBundleID}.nearby`]);
	const app = await read("ios/Config/Info.plist");
	const widget = await read("ios/Config/Widget-Info.plist");
	const entitlements = await read("ios/Config/WidgetShared.entitlements");
	assert.equal(plistString(app, "FerryWidgetKeychainGroup"), keychainGroup);
	assert.equal(plistString(widget, "FerryWidgetKeychainGroup"), keychainGroup);
	assert.ok(entitlements.includes(`<array><string>${keychainGroup}</string></array>`));
	assert.equal((spec.match(/FerryWidgetKeychainGroup: \$\(AppIdentifierPrefix\)nyc\.juliet\.ferryboard\.widgets/g) ?? []).length, 2);
	const bridge = await read("ios/Shared/WidgetSettingsBridge.swift");
	assert.ok(bridge.includes('kSecAttrService as String: "nyc.juliet.ferryboard.widget-settings"'));
	assert.ok(bridge.includes('kSecAttrAccount as String: "defaults-v1"'));
	const appSource = await read("ios/FerryKitty/FerryKittyApp.swift");
	assert.ok(appSource.includes('appendingPathComponent("FerryBoard", isDirectory: true)'));
	assert.ok(appSource.includes('UserDefaults(suiteName: "nyc.juliet.ferryboard.ui-tests")'));
	const store = await read("ios/FerryKitty/FerryStore.swift");
	for (const key of ["preferences", "widget-options", "ride-session"]) assert.ok(store.includes(`data(forKey: "${key}")`));
	assert.match(store, /reloadTimelines\(ofKind: "NearbyFerries"\)/);
	assert.match(await read("ios/FerryKittyWidget/FerryKittyWidget.swift"), /let kind = "NearbyFerries"/);
	const provider = await read("ios/FerryKittyWidget/NearbyProvider.swift");
	assert.ok(provider.includes('appendingPathComponent("NearbyFerries", isDirectory: true)'));
	assert.ok(provider.includes('data(forKey: "widget-last-landing")'));
});

test("existing widget deep links remain registered and emitted consistently", async () => {
	const spec = await project();
	assert.match(spec, /CFBundleURLSchemes: \[ferryboard\]/);
	assert.equal(plistString(await read("ios/Config/Info.plist"), "CFBundleURLName"), installedBundleID);
	assert.match(await read("ios/Config/Info.plist"), /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>ferryboard<\/string>/);
	assert.match(await read("ios/FerryCore/Sources/FerryCore/FerryWidgetLink.swift"), /url\.scheme\?\.lowercased\(\) == "ferryboard"/);
	const widgetView = await read("ios/FerryKittyWidget/NearbyWidgetView.swift");
	assert.match(widgetView, /ferryboard:\/\/landing\//);
	assert.match(widgetView, /ferryboard:\/\/nearby/);
});
