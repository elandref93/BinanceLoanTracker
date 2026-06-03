// Use Sentry's Expo Metro wrapper so production bundles emit the source maps
// Sentry needs to symbolicate native + JS stack traces. It delegates to
// expo/metro-config under the hood, so it is a drop-in for getDefaultConfig.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

module.exports = getSentryExpoConfig(__dirname);
