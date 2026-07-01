import SwiftUI
import WidgetKit

struct LedgerWidgetBundle: WidgetBundle {
    var body: some Widget {
        DashboardWidget()
        HomeWidget()
        BtcPriceWidget()
        LendPriceWidget()
        LockWidget()
    }
}
