// Minimal SwiftUI watchOS host. The complications are declared in
// LedgerComplication.swift as a WidgetBundle. This app target is the
// container required for the watch face to surface them.

import SwiftUI

@main
struct LedgerWatchApp: App {
  var body: some Scene {
    WindowGroup {
      WatchRootView()
    }
  }
}

struct WatchRootView: View {
  @State private var snapshot: WatchSnapshot? = WatchSharedData.load()

  var body: some View {
    VStack(spacing: 4) {
      if let s = snapshot {
        Text("LTV")
          .font(.system(size: 11, weight: .semibold))
          .foregroundColor(.secondary)
        Text(String(format: "%.1f%%", s.aggregateLtv))
          .font(.system(size: 28, weight: .bold, design: .rounded))
          .foregroundColor(Color("AccentColor"))
        if let asset = s.closestAsset {
          Text("Closest: \(asset)")
            .font(.system(size: 11))
            .foregroundColor(.secondary)
        }
      } else {
        Text("Open the iPhone app\nto sync your loans")
          .multilineTextAlignment(.center)
          .font(.system(size: 12))
          .foregroundColor(.secondary)
      }
    }
    .padding()
    .onAppear { snapshot = WatchSharedData.load() }
  }
}
