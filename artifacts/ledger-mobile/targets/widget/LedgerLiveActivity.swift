// LedgerLiveActivity.swift
//
// Scaffolds a Dynamic Island / Lock Screen Live Activity for an in-progress
// loan-risk session. The activity itself is started/ended from a custom
// native module (see lib/liveActivity.ts) — this file only declares the
// ActivityKit attributes and the WidgetKit views.
//
// NOTE: building this scaffold into TestFlight requires:
//   1. The custom native module that calls Activity<LedgerActivityAttributes>
//      .request(...). The JS stub in lib/liveActivity.ts no-ops until then.
//   2. NSSupportsLiveActivities=true in the host app's Info.plist (set in
//      app.json). Already configured.

import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.2, *)
struct LedgerActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// Aggregate LTV across all open loans, as a percent (e.g. 58.7).
    var ltv: Double
    /// "Closest-to-liquidation" loan label, e.g. "BTC".
    var closestAsset: String
    /// User's target LTV (used to colour the dial).
    var targetLtv: Double
  }

  /// Static for the lifetime of the activity. Display name only.
  var sessionName: String
}

@available(iOS 16.2, *)
struct LedgerLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: LedgerActivityAttributes.self) { context in
      // Lock Screen / banner UI.
      HStack {
        VStack(alignment: .leading, spacing: 2) {
          Text("LTV")
            .font(.system(size: 10, weight: .semibold))
            .foregroundColor(Color("WidgetForegroundMuted"))
          Text(String(format: "%.1f%%", context.state.ltv))
            .font(.system(size: 22, weight: .bold, design: .rounded))
            .foregroundColor(Color("WidgetForeground"))
        }
        Spacer()
        Text(context.state.closestAsset)
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(Color("AccentColor"))
      }
      .padding()
      .activityBackgroundTint(Color("WidgetBackground"))
      .activitySystemActionForegroundColor(Color("WidgetForeground"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text("LTV")
            .font(.system(size: 11, weight: .semibold))
            .foregroundColor(Color("WidgetForegroundMuted"))
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(String(format: "%.1f%%", context.state.ltv))
            .font(.system(size: 14, weight: .bold, design: .rounded))
            .foregroundColor(Color("AccentColor"))
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text("Closest: \(context.state.closestAsset)")
            .font(.system(size: 11))
            .foregroundColor(Color("WidgetForegroundMuted"))
        }
      } compactLeading: {
        Text("L")
          .font(.system(size: 12, weight: .bold))
          .foregroundColor(Color("AccentColor"))
      } compactTrailing: {
        Text(String(format: "%.0f%%", context.state.ltv))
          .font(.system(size: 12, weight: .semibold, design: .rounded))
      } minimal: {
        Text(String(format: "%.0f", context.state.ltv))
          .font(.system(size: 11, weight: .bold))
      }
      .keylineTint(Color("AccentColor"))
    }
  }
}
