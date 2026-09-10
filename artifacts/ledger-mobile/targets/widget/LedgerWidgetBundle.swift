import SwiftUI
import WidgetKit

// @main emits the Mach-O __swift5_entry section App Store Connect requires
// (ITMS-90896). Without it the widget extension binary cannot launch.
@main
struct LedgerWidgetBundle: WidgetBundle {
    var body: some Widget {
        DashboardWidget()
        HomeWidget()
        BtcPriceWidget()
        LendPriceWidget()
        LockWidget()
    }
}
