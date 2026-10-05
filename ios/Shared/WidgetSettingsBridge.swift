import Foundation
import Security
import FerryCore

/// The app is the sole writer. Both targets share only this small settings record,
/// using their explicitly provisioned keychain group (no location or credentials).
enum WidgetSettingsBridge {
    private static func query() -> [String: Any]? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "FerryWidgetKeychainGroup") as? String,
              !group.isEmpty, !group.contains("$(") else { return nil }
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "nyc.juliet.ferryboard.widget-settings",
                kSecAttrAccount as String: "defaults-v1",
                kSecAttrAccessGroup as String: group]
    }

    static func read() -> WidgetSettingsRecord? {
        guard var query = query() else { return nil }
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(WidgetSettingsRecord.self, from: data)
    }

    @discardableResult static func write(_ record: WidgetSettingsRecord) -> OSStatus {
        guard let query = query() else { return errSecMissingEntitlement }
        guard let data = try? JSONEncoder().encode(record) else { return errSecParam }
        let changes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, changes as CFDictionary)
        if status == errSecItemNotFound {
            return SecItemAdd(query.merging(changes) { _, new in new } as CFDictionary, nil)
        }
        return status
    }
}
