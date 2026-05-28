/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "watch-widget",
  name: "LedgerWatchComplication",
  // Watch complications are embedded inside the watch app, so Apple's
  // "embedded binary bundle ID must be prefixed with parent" rule
  // requires this to start with the watch app's bundle ID
  // (com.ubuntu.life.ledger.watchkitapp), NOT the iOS app's bundle ID.
  // Earlier `.watchwidget` (sibling of the watch app) tripped the
  // embedded-binary check in Xcode archive.
  bundleIdentifier: "com.ubuntu.life.ledger.watchkitapp.complication",
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
