import SwiftUI
import WidgetKit

struct LockWidget: Widget {
    let kind = "LedgerLockWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            LockWidgetView(snapshot: entry.snapshot)
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Ledger LTV")
        .description("Aggregate LTV on the lock screen.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct LockWidgetView: View {
    let snapshot: LoanSnapshot
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            circular
        case .accessoryRectangular:
            rectangular
        default:
            inline
        }
    }

    private var circular: some View {
        ZStack {
            Circle()
                .stroke(Color.ledgerMuted.opacity(0.4), lineWidth: 3)
            Circle()
                .trim(from: 0, to: min(snapshot.aggregateLtv / 78.0, 1.0))
                .stroke(
                    snapshot.status() == .danger ? Color.white : Color.white,
                    style: StrokeStyle(lineWidth: 3, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text(String(format: "%.0f", snapshot.aggregateLtv))
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .monospacedDigit()
                Text("LTV")
                    .font(.system(size: 7, weight: .semibold))
                    .tracking(0.5)
            }
        }
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("LEDGER")
                .font(.system(size: 9, weight: .semibold))
                .tracking(1.5)
            Text(String(format: "%.1f%% LTV", snapshot.aggregateLtv))
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .monospacedDigit()
            if let asset = snapshot.closestAsset, let drop = snapshot.priceDropPctToLiq {
                Text(String(format: "%@ −%.1f%% to liq", asset, drop))
                    .font(.system(size: 11))
            }
        }
    }

    private var inline: some View {
        Text(String(format: "LTV %.1f%% · %@", snapshot.aggregateLtv, snapshot.status().label))
    }
}
