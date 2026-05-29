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
        .description("Portfolio LTV, debt and the loan closest to liquidation.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct HomeWidgetView: View {
    let snapshot: LoanSnapshot
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .systemSmall:
            small
        case .systemLarge:
            large
        default:
            medium
        }
    }

    // MARK: Shared bits

    private func label(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 9, weight: .semibold))
            .tracking(1.5)
            .foregroundStyle(Color.ledgerMuted)
    }

    private func metric(_ caption: String, _ value: String, color: Color = .ledgerFg) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(caption)
                .font(.system(size: 8, weight: .semibold))
                .tracking(1.0)
                .foregroundStyle(Color.ledgerMuted)
            Text(value)
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Small

    private var small: some View {
        VStack(alignment: .leading, spacing: 6) {
            label("AGGREGATE LTV")
            Text(String(format: "%.1f%%", snapshot.aggregateLtv))
                .font(.system(size: 36, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(snapshot.status().color)
            Text(String(format: "%@ debt", compactUsd(snapshot.totalDebtUsd)))
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Color.ledgerMuted)
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

    // MARK: Medium

    private var medium: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                label("AGGREGATE LTV")
                Text(String(format: "%.1f%%", snapshot.aggregateLtv))
                    .font(.system(size: 38, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(snapshot.status().color)
                Text(snapshot.status().label)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(snapshot.status().color)
                Spacer(minLength: 0)
                HStack(spacing: 10) {
                    metric("DEBT", compactUsd(snapshot.totalDebtUsd))
                    metric("EQUITY", compactUsd(snapshot.equityUsd), color: .ledgerTint)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Divider().background(Color.ledgerMuted.opacity(0.3))

            VStack(alignment: .leading, spacing: 6) {
                label("CLOSEST TO LIQ")
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
                Spacer(minLength: 0)
                Text(snapshot.stalenessLabel())
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(snapshot.isStale() ? RiskStatus.warn.color : Color.ledgerMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: Large

    private var large: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header: aggregate LTV + status
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    label("AGGREGATE LTV")
                    Text(String(format: "%.1f%%", snapshot.aggregateLtv))
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(snapshot.status().color)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(snapshot.status().label)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(snapshot.status().color)
                    Text("\(snapshot.loanCount ?? 0) loans")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(Color.ledgerMuted)
                }
            }

            // Totals row
            HStack(spacing: 10) {
                metric("DEBT", compactUsd(snapshot.totalDebtUsd))
                metric("COLLATERAL", compactUsd(snapshot.totalCollateralUsd))
                metric("EQUITY", compactUsd(snapshot.equityUsd), color: .ledgerTint)
            }

            Divider().background(Color.ledgerMuted.opacity(0.25))

            // Per-account breakdown
            if let accounts = snapshot.accounts, !accounts.isEmpty {
                ForEach(accounts) { acct in
                    accountRow(acct)
                }
            } else if let asset = snapshot.closestAsset, let drop = snapshot.priceDropPctToLiq {
                HStack {
                    Text("Closest to liquidation")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.ledgerMuted)
                    Spacer()
                    Text(String(format: "%@  -%.1f%%", asset, drop))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(RiskStatus.danger.color)
                }
            }

            Spacer(minLength: 0)

            HStack {
                if let asset = snapshot.closestAsset, let drop = snapshot.priceDropPctToLiq {
                    Text(String(format: "%@ −%.1f%% to liq", asset, drop))
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(RiskStatus.danger.color)
                }
                Spacer()
                Text(snapshot.stalenessLabel())
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(snapshot.isStale() ? RiskStatus.warn.color : Color.ledgerMuted)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func accountRow(_ acct: AccountSnapshot) -> some View {
        HStack(spacing: 10) {
            Circle()
                .fill(acct.status().color)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 1) {
                Text(acct.label)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.ledgerFg)
                Text("\(acct.loanCount) loan\(acct.loanCount == 1 ? "" : "s") · \(compactUsd(acct.debtUsd)) debt")
                    .font(.system(size: 10))
                    .foregroundStyle(Color.ledgerMuted)
            }
            Spacer()
            Text(String(format: "%.1f%%", acct.ltv))
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(acct.status().color)
        }
    }
}
