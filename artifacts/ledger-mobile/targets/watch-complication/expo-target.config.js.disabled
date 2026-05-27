/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "watch-widget",
  name: "LedgerWatchComplication",
  // Full ID (not a main-app suffix): Apple rejects ".watchkitapp.complication".
  bundleIdentifier: "com.ubuntu.life.ledger.watchwidget",
  icon: "../../assets/images/icon.png",
  deploymentTarget: "10.0",
  colors: {
    $accent: "#00F0FF",
    $widgetBackground: "#06090C",
  },
  entitlements: {
    "com.apple.security.application-groups": ["group.com.ledger.shared"],
  },
};
