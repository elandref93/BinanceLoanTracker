/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "widget",
  name: "LedgerWidget",
  bundleIdentifier: ".widget",
  // Widget extensions inherit their AppIcon from the host app — supplying one
  // here makes apple-targets emit an empty AppIcon.appiconset which Xcode
  // rejects with "AppIcon did not have any applicable content".
  colors: {
    $accent: "#00F0FF",
    $widgetBackground: "#06090C",
  },
  entitlements: {
    "com.apple.security.application-groups": ["group.com.ledger.shared"],
  },
};
