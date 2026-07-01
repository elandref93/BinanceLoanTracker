import Foundation
import SwiftUI
import WidgetKit

/// Must match the App Group identifier configured on both the main app
/// target and the widget extension target.
let kAppGroup = "group.com.ledger.shared"
let kSnapshotKey = "ledger.snapshot.v1"

/// Binance liquidation LTV — keep in sync with `utils/risk.ts`.
let kLiqLtv = 91.0
/// Margin-call tier — keep in sync with `utils/risk.ts`.
let kWarningLtv = 85.0

struct MarketQuotes: Codable {
    let btcUsd: Double?
    let btcZar: Double?
    let lendAsset: String?
    let lendAssetZar: Double?
}

/// Per-account (Personal / Trust container) rollup shown in the large widget.
struct AccountSnapshot: Codable, Identifiable {
    let label: String
    let type: String
    let ltv: Double
    let debtUsd: Double
    let collateralUsd: Double
    let targetLtv: Double
    let loanCount: Int
    let weightedAprPct: Double?

    var id: String { label }

    func status() -> RiskStatus {
        RiskStatus.from(ltv: ltv, target: targetLtv)
    }
}

/// Snapshot the JS app writes into shared UserDefaults whenever loans refresh.
struct LoanSnapshot: Codable {
    let aggregateLtv: Double
    let totalDebtUsd: Double
    let totalCollateralUsd: Double
    let netEquityUsd: Double?
    let loanCount: Int?
    let weightedAprPct: Double?
    let closestAsset: String?
    let closestLtv: Double?
    let priceDropPctToLiq: Double?
    let targetLtv: Double?
    let accounts: [AccountSnapshot]?
    let markets: MarketQuotes?
    let updatedAt: Date

    var effectiveTargetLtv: Double {
        targetLtv ?? 65
    }

    var equityUsd: Double {
        netEquityUsd ?? (totalCollateralUsd - totalDebtUsd)
    }

    static let placeholder = LoanSnapshot(
        aggregateLtv: 64.2,
        totalDebtUsd: 18_500,
        totalCollateralUsd: 28_800,
        netEquityUsd: 10_300,
        loanCount: 3,
        weightedAprPct: 8.4,
        closestAsset: "BTC",
        closestLtv: 71.4,
        priceDropPctToLiq: 8.1,
        targetLtv: 65,
        accounts: [
            AccountSnapshot(label: "Personal", type: "personal", ltv: 61.2,
                            debtUsd: 9_500, collateralUsd: 15_500, targetLtv: 65,
                            loanCount: 2, weightedAprPct: 7.9),
            AccountSnapshot(label: "Trust", type: "trust", ltv: 67.8,
                            debtUsd: 9_000, collateralUsd: 13_300, targetLtv: 65,
                            loanCount: 1, weightedAprPct: 8.9),
        ],
        markets: MarketQuotes(
            btcUsd: 97_420,
            btcZar: 1_802_000,
            lendAsset: "USDC",
            lendAssetZar: 18.42
        ),
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
        RiskStatus.from(ltv: aggregateLtv, target: effectiveTargetLtv)
    }

    func ageSeconds() -> TimeInterval {
        max(0, Date().timeIntervalSince(updatedAt))
    }

    func isStale() -> Bool {
        ageSeconds() > 60 * 60
    }

    func stalenessLabel() -> String {
        let s = ageSeconds()
        if s < 60 { return "Updated just now" }
        if s < 60 * 60 { return "Updated \(Int(s / 60))m ago" }
        if s < 60 * 60 * 24 { return "Updated \(Int(s / 3600))h ago" }
        return "Updated \(Int(s / 86400))d ago"
    }
}

func aprLabel(_ apr: Double?) -> String {
    guard let apr = apr else { return "—" }
    return String(format: "%.1f%%", apr)
}

func compactUsd(_ value: Double) -> String {
    let v = abs(value)
    let sign = value < 0 ? "-" : ""
    if v >= 1_000_000 {
        return String(format: "%@$%.1fM", sign, v / 1_000_000)
    }
    if v >= 1_000 {
        return String(format: "%@$%.1fK", sign, v / 1_000)
    }
    return String(format: "%@$%.0f", sign, v)
}

/// Full USD price for market rows (CMC-style hero numbers).
func formatUsd(_ value: Double?) -> String {
    guard let value = value, value > 0 else { return "—" }
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.groupingSeparator = " "
    formatter.maximumFractionDigits = value >= 1000 ? 0 : 2
    formatter.minimumFractionDigits = value >= 1000 ? 0 : 2
    return "$" + (formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value))
}

/// Full ZAR price for Luno lend-asset rows.
func formatZar(_ value: Double?) -> String {
    guard let value = value, value > 0 else { return "—" }
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.groupingSeparator = " "
    formatter.maximumFractionDigits = value >= 1000 ? 0 : 2
    formatter.minimumFractionDigits = value >= 1000 ? 0 : 2
    return "R" + (formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value))
}

enum RiskStatus {
    case ok, warn, danger

    static func from(ltv: Double, target: Double) -> RiskStatus {
        if ltv >= kWarningLtv { return .danger }
        if ltv >= target { return .warn }
        return .ok
    }

    var color: Color {
        switch self {
        case .ok: return Color(red: 0.12, green: 0.71, blue: 0.65)
        case .warn: return Color(red: 0.96, green: 0.65, blue: 0.14)
        case .danger: return Color(red: 1.00, green: 0.30, blue: 0.43)
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
    static let ledgerBg = Color(red: 0.024, green: 0.035, blue: 0.047)
    static let ledgerCard = Color(red: 0.055, green: 0.078, blue: 0.102)
    static let ledgerFg = Color(red: 0.902, green: 0.945, blue: 0.969)
    static let ledgerMuted = Color(red: 0.431, green: 0.510, blue: 0.565)
    static let ledgerTint = Color(red: 0.0, green: 0.941, blue: 1.0)
    static let ledgerDivider = Color.white.opacity(0.08)
    static let ledgerOk = Color(red: 0.12, green: 0.71, blue: 0.65)
}

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
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}
