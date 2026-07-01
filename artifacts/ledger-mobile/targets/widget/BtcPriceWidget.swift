import SwiftUI
import WidgetKit

struct BtcPriceWidget: Widget {
    let kind = "LedgerBtcPriceWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            BtcPriceWidgetView(snapshot: entry.snapshot)
                .containerBackground(Color.ledgerBg, for: .widget)
        }
        .configurationDisplayName("BTC Price")
        .description("Live Bitcoin price in USD from Luno.")
        .supportedFamilies([.systemSmall])
    }
}

struct BtcPriceWidgetView: View {
    let snapshot: LoanSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            WidgetAssetHeader(symbol: "BTC", name: "Bitcoin", source: "Luno · USD")
            WidgetPriceHero(
                price: formatUsd(snapshot.markets?.btcUsd),
                subtitle: snapshot.markets?.btcZar.map { "R\(Int($0).formatted(.number.grouping(.automatic))) in ZAR" }
            )
            Spacer(minLength: 0)
            WidgetFooter(snapshot: snapshot)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
