/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "widget",
  name: "LedgerWidget",
  bundleIdentifier: ".widget",
  icon: "../../assets/images/icon.png",
  colors: {
    $accent: "#00F0FF",
    $widgetBackground: "#06090C",
  },
  entitlements: {
    "com.apple.security.application-groups": ["group.com.ledger.shared"],
  },
};
