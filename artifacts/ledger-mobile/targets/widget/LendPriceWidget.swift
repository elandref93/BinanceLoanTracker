import SwiftUI
import WidgetKit

struct LendPriceWidget: Widget {
    let kind = "LedgerLendPriceWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            LendPriceWidgetView(snapshot: entry.snapshot)
                .containerBackground(Color.ledgerBg, for: .widget)
        }
        .configurationDisplayName("Lend Asset")
        .description("Dominant borrowed asset price in ZAR on Luno.")
        .supportedFamilies([.systemSmall])
    }
}

struct LendPriceWidgetView: View {
    let snapshot: LoanSnapshot

    private var symbol: String {
        snapshot.markets?.lendAsset ?? "—"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            WidgetAssetHeader(
                symbol: symbol,
                name: "Borrowed",
                source: "Luno · ZAR"
            )
            WidgetPriceHero(
                price: formatZar(snapshot.markets?.lendAssetZar),
                subtitle: "Debt-weighted lend asset"
            )
            Spacer(minLength: 0)
            WidgetFooter(snapshot: snapshot)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
