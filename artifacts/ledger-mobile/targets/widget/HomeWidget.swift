import SwiftUI
import WidgetKit

struct HomeWidget: Widget {
    let kind = "LedgerHomeWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            HomeWidgetView(snapshot: entry.snapshot)
                .containerBackground(Color.ledgerBg, for: .widget)
        }
        .configurationDisplayName("Loan Health")
        .description("Portfolio LTV and closest-to-liquidation loan.")
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

    private var small: some View {
        VStack(alignment: .leading, spacing: 8) {
            WidgetSectionLabel(text: "AGGREGATE LTV")
            Text(String(format: "%.1f%%", snapshot.aggregateLtv))
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(snapshot.status().color)
            LtvRiskBar(ltv: snapshot.aggregateLtv, target: snapshot.effectiveTargetLtv)
            Spacer(minLength: 0)
            WidgetStatusPill(status: snapshot.status())
            WidgetFooter(snapshot: snapshot)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var medium: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                WidgetSectionLabel(text: "AGGREGATE LTV")
                Text(String(format: "%.1f%%", snapshot.aggregateLtv))
                    .font(.system(size: 36, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(snapshot.status().color)
                LtvRiskBar(ltv: snapshot.aggregateLtv, target: snapshot.effectiveTargetLtv)
                Spacer(minLength: 0)
                WidgetMetricRow(label: "Debt", value: compactUsd(snapshot.totalDebtUsd))
                WidgetMetricRow(label: "Equity", value: compactUsd(snapshot.equityUsd), valueColor: .ledgerTint)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Rectangle()
                .fill(Color.ledgerDivider)
                .frame(width: 1)

            VStack(alignment: .leading, spacing: 8) {
                WidgetSectionLabel(text: "CLOSEST TO LIQ")
                if let asset = snapshot.closestAsset, let drop = snapshot.priceDropPctToLiq {
                    Text(asset)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.ledgerFg)
                    Text(String(format: "−%.1f%%", drop))
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
                WidgetFooter(snapshot: snapshot)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var large: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    WidgetSectionLabel(text: "AGGREGATE LTV")
                    Text(String(format: "%.1f%%", snapshot.aggregateLtv))
                        .font(.system(size: 32, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(snapshot.status().color)
                }
                Spacer()
                WidgetStatusPill(status: snapshot.status())
            }

            LtvRiskBar(ltv: snapshot.aggregateLtv, target: snapshot.effectiveTargetLtv)

            HStack(spacing: 10) {
                mini("Debt", compactUsd(snapshot.totalDebtUsd))
                mini("APR", aprLabel(snapshot.weightedAprPct))
                mini("Coll.", compactUsd(snapshot.totalCollateralUsd))
                mini("Equity", compactUsd(snapshot.equityUsd), .ledgerTint)
            }

            WidgetDivider()

            if let accounts = snapshot.accounts, !accounts.isEmpty {
                ForEach(accounts) { acct in
                    HStack(spacing: 10) {
                        Circle().fill(acct.status().color).frame(width: 8, height: 8)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(acct.label)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Color.ledgerFg)
                            Text("\(acct.loanCount) loan\(acct.loanCount == 1 ? "" : "s") · \(compactUsd(acct.debtUsd))")
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

            Spacer(minLength: 0)
            WidgetFooter(snapshot: snapshot)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func mini(_ caption: String, _ value: String, _ color: Color = .ledgerFg) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(caption.uppercased())
                .font(.system(size: 8, weight: .semibold))
                .foregroundStyle(Color.ledgerMuted)
            Text(value)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
