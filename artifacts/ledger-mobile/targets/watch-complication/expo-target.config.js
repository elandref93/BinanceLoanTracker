/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "watch-widget",
  name: "LedgerWatchComplication",
  // Full ID (not a main-app suffix): Apple rejects ".watchkitapp.complication".
  bundleIdentifier: "com.ubuntu.life.ledger.watchwidget",
  // Widget extensions inherit their AppIcon from the host app — supplying one
  // here makes apple-targets emit an empty AppIcon.appiconset which Xcode
  // rejects with "AppIcon did not have any applicable content".
  deploymentTarget: "10.0",
  colors: {
    $accent: "#00F0FF",
    $widgetBackground: "#06090C",
  },
  entitlements: {
    "com.apple.security.application-groups": ["group.com.ledger.shared"],
  },
};
