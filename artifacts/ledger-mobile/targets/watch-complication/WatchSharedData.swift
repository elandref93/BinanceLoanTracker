// Mirrors the snapshot written by the iPhone app via App Group, used by
// both the watchOS app and the WidgetKit complications. Keep the JSON keys
// in sync with lib/widgetSnapshot.ts (LoanSnapshot type).

import Foundation

struct WatchSnapshot: Codable {
  let aggregateLtv: Double
  let totalDebtUsd: Double
  let totalCollateralUsd: Double
  let closestAsset: String?
  let closestLtv: Double?
  let priceDropPctToLiq: Double?
  let targetLtv: Double
  let updatedAt: String

  static let placeholder = WatchSnapshot(
    aggregateLtv: 0,
    totalDebtUsd: 0,
    totalCollateralUsd: 0,
    closestAsset: nil,
    closestLtv: nil,
    priceDropPctToLiq: nil,
    targetLtv: 65,
    updatedAt: ""
  )
}

enum WatchSharedData {
  static let appGroup = "group.com.ledger.shared"
  static let key = "ledger.snapshot.v1"

  static func load() -> WatchSnapshot? {
    guard
      let defaults = UserDefaults(suiteName: appGroup),
      let raw = defaults.string(forKey: key),
      let data = raw.data(using: .utf8)
    else { return nil }
    return try? JSONDecoder().decode(WatchSnapshot.self, from: data)
  }
}
