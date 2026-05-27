// Apple Watch complications (accessoryCircular + accessoryRectangular).
// Reads the same App Group snapshot as the iPhone widget so the watch
// shows the same aggregate LTV without its own network call.

import SwiftUI
import WidgetKit

struct LedgerComplicationProvider: TimelineProvider {
  func placeholder(in context: Context) -> LedgerComplicationEntry {
    LedgerComplicationEntry(date: Date(), snapshot: WatchSnapshot.placeholder)
  }

  func getSnapshot(
    in context: Context,
    completion: @escaping (LedgerComplicationEntry) -> Void
  ) {
    completion(
      LedgerComplicationEntry(
        date: Date(),
        snapshot: WatchSharedData.load() ?? WatchSnapshot.placeholder
      )
    )
  }

  func getTimeline(
    in context: Context,
    completion: @escaping (Timeline<LedgerComplicationEntry>) -> Void
  ) {
    let entry = LedgerComplicationEntry(
      date: Date(),
      snapshot: WatchSharedData.load() ?? WatchSnapshot.placeholder
    )
    // Refresh hourly; the iPhone background-fetch task also pushes fresher
    // data into the App Group whenever the OS wakes it.
    let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date())!
    completion(Timeline(entries: [entry], policy: .after(next)))
  }
}

struct LedgerComplicationEntry: TimelineEntry {
  let date: Date
  let snapshot: WatchSnapshot
}

struct LedgerComplicationView: View {
  @Environment(\.widgetFamily) var family
  var entry: LedgerComplicationEntry

  var body: some View {
    switch family {
    case .accessoryCircular:
      VStack(spacing: 0) {
        Text("LTV")
          .font(.system(size: 9, weight: .semibold))
          .foregroundColor(.secondary)
        Text(String(format: "%.0f%%", entry.snapshot.aggregateLtv))
          .font(.system(size: 18, weight: .bold, design: .rounded))
      }
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        Text("Ledger · LTV")
          .font(.system(size: 11, weight: .semibold))
          .foregroundColor(.secondary)
        Text(String(format: "%.1f%%", entry.snapshot.aggregateLtv))
          .font(.system(size: 22, weight: .bold, design: .rounded))
          .foregroundColor(Color("AccentColor"))
        if let asset = entry.snapshot.closestAsset {
          Text("Closest: \(asset)")
            .font(.system(size: 10))
            .foregroundColor(.secondary)
        }
      }
    default:
      Text(String(format: "%.0f", entry.snapshot.aggregateLtv))
    }
  }
}

@main
struct LedgerWatchBundle: WidgetBundle {
  var body: some Widget {
    LedgerComplication()
  }
}

struct LedgerComplication: Widget {
  let kind: String = "LedgerComplication"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: LedgerComplicationProvider()) { entry in
      LedgerComplicationView(entry: entry)
    }
    .configurationDisplayName("Ledger LTV")
    .description("Your aggregate Binance loan LTV.")
    .supportedFamilies([.accessoryCircular, .accessoryRectangular])
  }
}
