/**
 * withDisableSentryDebugUpload
 *
 * The `@sentry/react-native` Expo config plugin unconditionally adds an
 * "Upload Debug Symbols to Sentry" PBXShellScriptBuildPhase to the iOS
 * project. There is NO plugin option to skip it (PluginProps only exposes
 * organization/project/authToken/url/experimental_android).
 *
 * That phase runs `scripts/sentry-xcode-debug-files.sh`, which does
 * `set -e` and resolves `@sentry/cli` (and then attempts a
 * `debug-files upload`) BEFORE it ever checks SENTRY_DISABLE_AUTO_UPLOAD.
 * In this pnpm monorepo the phase fails the archive (xcodebuild exit 65,
 * "** ARCHIVE FAILED **") regardless of SENTRY_DISABLE_AUTO_UPLOAD, because
 * the failure happens earlier in the script than the skip check.
 *
 * dSYM upload is optional — it only adds symbolication for *native* crashes.
 * JavaScript error reporting (the main value of Sentry here) is unaffected.
 * So we neutralize this phase's shell script to a no-op so the archive can
 * complete. To re-enable native-crash symbolication later, remove this
 * plugin and provide a Sentry auth token (scoped to the eap-k2 org with
 * upload permission) to the EAS build.
 *
 * Plugin order in app.json:
 *   - MUST run AFTER `@sentry/react-native` so the build phase already
 *     exists in the Xcode project when we rewrite it.
 */
const { createRequire } = require("node:module");
const path = require("node:path");

const expoPackageJson = require.resolve("expo/package.json", {
  paths: [path.join(__dirname, ".."), process.cwd()],
});
const expoRequire = createRequire(expoPackageJson);
const { withXcodeProject } = expoRequire("@expo/config-plugins");

const PHASE_COMMENT = "Upload Debug Symbols to Sentry";
const NOOP_SCRIPT =
  'echo "Sentry debug-symbol upload disabled by withDisableSentryDebugUpload plugin"';

module.exports = function withDisableSentryDebugUpload(config) {
  return withXcodeProject(config, (cfg) => {
    const proj = cfg.modResults;
    const phase = proj.pbxItemByComment(
      PHASE_COMMENT,
      "PBXShellScriptBuildPhase",
    );

    if (!phase) {
      console.warn(
        `[withDisableSentryDebugUpload] No "${PHASE_COMMENT}" build phase found — nothing to disable.`,
      );
      return cfg;
    }

    phase.shellScript = JSON.stringify(NOOP_SCRIPT);
    console.log(
      `[withDisableSentryDebugUpload] Neutralized "${PHASE_COMMENT}" build phase.`,
    );
    return cfg;
  });
};
