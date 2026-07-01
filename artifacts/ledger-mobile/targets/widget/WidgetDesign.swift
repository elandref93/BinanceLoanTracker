import SwiftUI

// Shared CMC-inspired widget chrome: dark card, thin dividers, label/value rows.

struct WidgetSectionLabel: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 9, weight: .semibold))
            .tracking(1.4)
            .foregroundStyle(Color.ledgerMuted)
    }
}

struct WidgetDivider: View {
    var body: some View {
        Rectangle()
            .fill(Color.ledgerDivider)
            .frame(height: 1)
    }
}

struct WidgetMetricRow: View {
    let label: String
    let value: String
    var valueColor: Color = .ledgerFg

    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.ledgerMuted)
            Spacer(minLength: 8)
            Text(value)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(valueColor)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
    }
}

struct WidgetStatusPill: View {
    let status: RiskStatus

    var body: some View {
        Text(status.label)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(status.color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(status.color.opacity(0.15))
            .clipShape(Capsule())
    }
}

struct WidgetAssetHeader: View {
    let symbol: String
    let name: String
    let source: String

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            ZStack {
                Circle()
                    .fill(Color.ledgerCard)
                    .frame(width: 28, height: 28)
                Text(String(symbol.prefix(1)))
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color.ledgerTint)
            }
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text(symbol)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Color.ledgerFg)
                    Text(name)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.ledgerMuted)
                        .lineLimit(1)
                }
                Text(source)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(Color.ledgerMuted.opacity(0.85))
            }
            Spacer(minLength: 0)
        }
    }
}

struct WidgetPriceHero: View {
    let price: String
    var subtitle: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(price)
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(Color.ledgerFg)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Color.ledgerMuted)
            }
        }
    }
}

/// LTV progress toward liquidation (0 → 91%).
struct LtvRiskBar: View {
    let ltv: Double
    let target: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Low")
                    .font(.system(size: 8, weight: .medium))
                    .foregroundStyle(Color.ledgerMuted)
                Spacer()
                Text("Liq \(Int(kLiqLtv))%")
                    .font(.system(size: 8, weight: .medium))
                    .foregroundStyle(Color.ledgerMuted)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color.ledgerCard)
                    Capsule()
                        .fill(RiskStatus.from(ltv: ltv, target: target).color)
                        .frame(width: geo.size.width * min(max(ltv / kLiqLtv, 0), 1))
                    if target < kLiqLtv {
                        Rectangle()
                            .fill(Color.ledgerMuted.opacity(0.8))
                            .frame(width: 2, height: geo.size.height + 4)
                            .offset(x: geo.size.width * (target / kLiqLtv) - 1)
                    }
                }
            }
            .frame(height: 6)
        }
    }
}

struct WidgetFooter: View {
    let snapshot: LoanSnapshot

    var body: some View {
        Text(snapshot.stalenessLabel())
            .font(.system(size: 9, weight: .medium))
            .foregroundStyle(snapshot.isStale() ? RiskStatus.warn.color : Color.ledgerMuted)
    }
}
