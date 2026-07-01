import SwiftUI
import WidgetKit

/// Mega at-a-glance widget: loan health, BTC USD, lend asset ZAR, accounts.
struct DashboardWidget: Widget {
    let kind = "LedgerDashboardWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            DashboardWidgetView(snapshot: entry.snapshot)
                .containerBackground(Color.ledgerBg, for: .widget)
        }
        .configurationDisplayName("Ledger Dashboard")
        .description("LTV health, BTC price, lend rate and accounts in one view.")
        .supportedFamilies([.systemLarge])
    }
}

struct DashboardWidgetView: View {
    let snapshot: LoanSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    WidgetSectionLabel(text: "PORTFOLIO LTV")
                    Text(String(format: "%.1f%%", snapshot.aggregateLtv))
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(snapshot.status().color)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    WidgetStatusPill(status: snapshot.status())
                    Text("\(snapshot.loanCount ?? 0) loans")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(Color.ledgerMuted)
                }
            }

            LtvRiskBar(ltv: snapshot.aggregateLtv, target: snapshot.effectiveTargetLtv)

            WidgetDivider()

            WidgetMetricRow(
                label: "BTC · USD",
                value: formatUsd(snapshot.markets?.btcUsd)
            )
            WidgetMetricRow(
                label: "\(snapshot.markets?.lendAsset ?? "Lend") · ZAR",
                value: formatZar(snapshot.markets?.lendAssetZar)
            )

            WidgetDivider()

            HStack(spacing: 10) {
                miniStat("Debt", compactUsd(snapshot.totalDebtUsd))
                miniStat("Equity", compactUsd(snapshot.equityUsd), color: .ledgerTint)
                miniStat("APR", aprLabel(snapshot.weightedAprPct))
            }

            if let asset = snapshot.closestAsset, let drop = snapshot.priceDropPctToLiq {
                WidgetMetricRow(
                    label: "Closest to liq",
                    value: String(format: "%@ −%.1f%%", asset, drop),
                    valueColor: RiskStatus.danger.color
                )
            }

            if let accounts = snapshot.accounts, !accounts.isEmpty {
                WidgetDivider()
                ForEach(accounts.prefix(3)) { acct in
                    HStack(spacing: 8) {
                        Circle()
                            .fill(acct.status().color)
                            .frame(width: 7, height: 7)
                        Text(acct.label)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color.ledgerFg)
                        Spacer()
                        Text(String(format: "%.1f%%", acct.ltv))
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(acct.status().color)
                    }
                }
            }

            Spacer(minLength: 0)
            WidgetFooter(snapshot: snapshot)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func miniStat(_ caption: String, _ value: String, color: Color = .ledgerFg) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(caption.uppercased())
                .font(.system(size: 8, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(Color.ledgerMuted)
            Text(value)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
