import SwiftUI
import WidgetKit

struct HomeWidget: Widget {
    let kind = "LedgerHomeWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            HomeWidgetView(snapshot: entry.snapshot)
                .containerBackground(Color.ledgerBg, for: .widget)
        }
        .configurationDisplayName("Ledger LTV")
        .description("Aggregate LTV and the loan closest to liquidation.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct HomeWidgetView: View {
    let snapshot: LoanSnapshot
    @Environment(\.widgetFamily) var family

    var body: some View {
        if family == .systemSmall {
            small
        } else {
            medium
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("AGGREGATE LTV")
                .font(.system(size: 9, weight: .semibold))
                .tracking(1.5)
                .foregroundStyle(Color.ledgerMuted)
            Text(String(format: "%.1f%%", snapshot.aggregateLtv))
                .font(.system(size: 36, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(snapshot.status().color)
            Spacer(minLength: 0)
            Text(snapshot.status().label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(snapshot.status().color)
            Text(snapshot.stalenessLabel())
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(snapshot.isStale() ? RiskStatus.warn.color : Color.ledgerMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var medium: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("AGGREGATE LTV")
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(1.5)
                    .foregroundStyle(Color.ledgerMuted)
                Text(String(format: "%.1f%%", snapshot.aggregateLtv))
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(snapshot.status().color)
                Text(snapshot.status().label)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(snapshot.status().color)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Divider().background(Color.ledgerMuted.opacity(0.3))

            VStack(alignment: .leading, spacing: 6) {
                Text("CLOSEST TO LIQ")
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(1.5)
                    .foregroundStyle(Color.ledgerMuted)
                if let asset = snapshot.closestAsset, let drop = snapshot.priceDropPctToLiq {
                    Text(asset)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.ledgerFg)
                    Text(String(format: "-%.1f%%", drop))
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(RiskStatus.danger.color)
                    Text("price drop")
                        .font(.system(size: 10))
                        .foregroundStyle(Color.ledgerMuted)
                } else {
                    Text("—")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(Color.ledgerMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
