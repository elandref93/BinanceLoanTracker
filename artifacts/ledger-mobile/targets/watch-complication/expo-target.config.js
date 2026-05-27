/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "watch-widget",
  name: "LedgerWatchComplication",
  bundleIdentifier: ".watchkitapp.complication",
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
