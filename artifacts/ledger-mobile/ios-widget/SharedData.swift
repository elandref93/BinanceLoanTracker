import Foundation
import WidgetKit

/// Must match the App Group identifier configured on both the main app
/// target and the widget extension target.
let kAppGroup = "group.com.ledger.shared"
let kSnapshotKey = "ledger.snapshot.v1"

/// Snapshot the JS app writes into shared UserDefaults whenever loans refresh.
struct LoanSnapshot: Codable {
    let aggregateLtv: Double         // 0..100
    let totalDebtUsd: Double
    let totalCollateralUsd: Double
    let closestAsset: String?        // collateral symbol of the worst loan
    let closestLtv: Double?          // its LTV
    let priceDropPctToLiq: Double?   // % drop in collateral price until 78%
    let updatedAt: Date

    static let placeholder = LoanSnapshot(
        aggregateLtv: 64.2,
        totalDebtUsd: 18_500,
        totalCollateralUsd: 28_800,
        closestAsset: "BTC",
        closestLtv: 71.4,
        priceDropPctToLiq: 8.1,
        updatedAt: Date()
    )

    static func load() -> LoanSnapshot {
        guard
            let defaults = UserDefaults(suiteName: kAppGroup),
            let raw = defaults.string(forKey: kSnapshotKey),
            let data = raw.data(using: .utf8)
        else { return .placeholder }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode(LoanSnapshot.self, from: data)) ?? .placeholder
    }

    func status() -> RiskStatus {
        if aggregateLtv >= 72 { return .danger }
        if aggregateLtv >= 65 { return .warn }
        return .ok
    }
}

enum RiskStatus {
    case ok, warn, danger

    var color: Color {
        switch self {
        case .ok: return Color(red: 0.12, green: 0.71, blue: 0.65)        // #1FB6A6
        case .warn: return Color(red: 0.96, green: 0.65, blue: 0.14)      // #F5A524
        case .danger: return Color(red: 1.00, green: 0.30, blue: 0.43)    // #FF4D6D
        }
    }

    var label: String {
        switch self {
        case .ok: return "Healthy"
        case .warn: return "Caution"
        case .danger: return "At risk"
        }
    }
}

extension Color {
    static let ledgerBg = Color(red: 0.024, green: 0.035, blue: 0.047)    // #06090C
    static let ledgerCard = Color(red: 0.055, green: 0.078, blue: 0.102)  // #0E141A
    static let ledgerFg = Color(red: 0.902, green: 0.945, blue: 0.969)    // #E6F1F7
    static let ledgerMuted = Color(red: 0.431, green: 0.510, blue: 0.565) // #6E8290
    static let ledgerTint = Color(red: 0.0, green: 0.941, blue: 1.0)      // #00F0FF
}

// MARK: - Timeline plumbing

struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: LoanSnapshot
}

struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry {
        SnapshotEntry(date: Date(), snapshot: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(SnapshotEntry(date: Date(), snapshot: LoanSnapshot.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        let entry = SnapshotEntry(date: Date(), snapshot: LoanSnapshot.load())
        // Refresh every 15 minutes; the JS app also pokes WidgetCenter on refresh.
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}
