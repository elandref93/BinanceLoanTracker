/**
 * withNativeLaunchLogging
 *
 * The TestFlight SIGABRT happens in expo-updates ErrorRecovery *before*
 * JS Sentry.init in app/_layout.tsx, so cloud/on-device reporters never
 * see it. This plugin patches AppDelegate.swift so that, on every cold
 * start and *before* Expo/Updates runs:
 *
 *   1. Native Sentry starts (crash envelopes survive the abort and upload
 *      on the next launch).
 *   2. An NSUncaughtException handler NSLogs the exception and writes it
 *      to the App Group UserDefaults for JS to ingest if the next launch
 *      gets far enough.
 *
 * Plugin order: after `@sentry/react-native` so the Sentry pod is already
 * on the target; the Swift `import Sentry` needs it at compile time.
 */
const { createRequire } = require("node:module");
const path = require("node:path");

const expoPackageJson = require.resolve("expo/package.json", {
  paths: [path.join(__dirname, ".."), process.cwd()],
});
const expoRequire = createRequire(expoPackageJson);
const { withAppDelegate } = expoRequire("@expo/config-plugins");

const HELPER_MARKER = "enum LedgerLaunchLog";

const SENTRY_IMPORT = "import Sentry";

const START_CALL = "    LedgerLaunchLog.start()";

const HELPER = `
// MARK: - LedgerLaunchLog (injected by withNativeLaunchLogging)
enum LedgerLaunchLog {
  static let appGroup = "group.com.ledger.shared"
  static let abortKey = "ledger.lastNativeAbort"
  static let dsn = "https://3fae81419d7ff0214ca6b500ebf22e01@o4511503179907072.ingest.us.sentry.io/4511503195832320"
  static var previousExceptionHandler: NSUncaughtExceptionHandler?

  static func start() {
    let info = Bundle.main.infoDictionary
    let version = info?["CFBundleShortVersionString"] as? String ?? "?"
    let build = info?["CFBundleVersion"] as? String ?? "?"
    NSLog("[LedgerLaunch] native start version=%@ build=%@", version, build)
    startSentry(version: version, build: build)
    installExceptionHook()
    NSLog("[LedgerLaunch] sentry+exception hook ready")
  }

  static func startSentry(version: String, build: String) {
    SentrySDK.start { options in
      options.dsn = dsn
      options.environment = "production"
      options.enableAutoSessionTracking = true
      options.enableWatchdogTerminationTracking = true
      let id = Bundle.main.bundleIdentifier ?? "com.ubuntu.life.ledger"
      options.releaseName = "\\(id)@\\(version)+\\(build)"
      options.dist = build
    }
  }

  static func installExceptionHook() {
    previousExceptionHandler = NSGetUncaughtExceptionHandler()
    NSSetUncaughtExceptionHandler(LedgerHandleUncaughtException)
  }

  static func record(_ exception: NSException) {
    let name = exception.name.rawValue
    let reason = exception.reason ?? ""
    let stack = exception.callStackSymbols.joined(separator: "\\n")
    NSLog("[LedgerLaunch] uncaught %@ — %@", name, reason)
    NSLog("[LedgerLaunch] stack %@", stack)
    let payload: [String: Any] = [
      "time": ISO8601DateFormatter().string(from: Date()),
      "name": name,
      "reason": reason,
      "stack": stack,
    ]
    if let data = try? JSONSerialization.data(withJSONObject: payload),
       let json = String(data: data, encoding: .utf8) {
      let defaults = UserDefaults(suiteName: appGroup)
      defaults?.set(json, forKey: abortKey)
      defaults?.synchronize()
    }
  }
}

func LedgerHandleUncaughtException(_ exception: NSException) {
  LedgerLaunchLog.record(exception)
  LedgerLaunchLog.previousExceptionHandler?(exception)
}
`;

module.exports = function withNativeLaunchLogging(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") {
      console.warn(
        "[withNativeLaunchLogging] AppDelegate is not Swift — skipping.",
      );
      return cfg;
    }

    let contents = cfg.modResults.contents;
    if (contents.includes(HELPER_MARKER)) {
      console.log(
        "[withNativeLaunchLogging] LedgerLaunchLog already present — skipping.",
      );
      return cfg;
    }

    if (!contents.includes(SENTRY_IMPORT)) {
      if (contents.includes("import Expo\n")) {
        contents = contents.replace("import Expo\n", `import Expo\n${SENTRY_IMPORT}\n`);
      } else {
        contents = `${SENTRY_IMPORT}\n${contents}`;
      }
    }

    const launchSig = /didFinishLaunchingWithOptions launchOptions:[^{]*\{/;
    if (!launchSig.test(contents)) {
      console.warn(
        "[withNativeLaunchLogging] didFinishLaunchingWithOptions not found — skipping inject.",
      );
      cfg.modResults.contents = contents;
      return cfg;
    }
    contents = contents.replace(launchSig, (match) => `${match}\n${START_CALL}`);

    contents = `${contents.trimEnd()}\n${HELPER}\n`;
    cfg.modResults.contents = contents;
    console.log("[withNativeLaunchLogging] Injected LedgerLaunchLog into AppDelegate.swift");
    return cfg;
  });
};
