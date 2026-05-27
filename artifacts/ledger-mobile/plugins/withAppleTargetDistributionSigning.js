/**
 * withAppleTargetDistributionSigning
 *
 * Forces Apple-target extensions (Widget Extension etc) to use **Apple
 * Distribution** signing for the Release build configuration. Without
 * this plugin, @bacons/apple-targets generates the LedgerWidget target
 * with build settings that Xcode interprets as "look for an iOS App
 * Development provisioning profile" — even when the EAS build is doing
 * an app-store archive. The result on EAS is a fastlane archive failure:
 *
 *     No profiles for 'com.ubuntu.life.ledger.widget' were found:
 *     Xcode couldn't find any iOS App Development provisioning profiles
 *     matching 'com.ubuntu.life.ledger.widget'.
 *
 * This plugin patches the generated .pbxproj so the named target's
 * Release configuration uses:
 *   - CODE_SIGN_STYLE        = "Manual"
 *   - CODE_SIGN_IDENTITY     = "Apple Distribution"
 *   - DEVELOPMENT_TEAM       = <ios.appleTeamId from app.json>
 *
 * PROVISIONING_PROFILE_SPECIFIER is intentionally left blank — EAS fills
 * it in from the credentials sync (which already knows about the
 * AppStore profile UUID for this bundle ID). If you're building OUTSIDE
 * of EAS, set it manually in Xcode or via an env override.
 *
 * Plugin order matters: this MUST run after `@bacons/apple-targets` so
 * that the target it modifies actually exists in the project tree.
 *
 * @param {object} config — Expo config
 * @param {{ targetNames?: string[] }} [props] — list of target names to
 *   patch. Defaults to ["LedgerWidget"] since that's the only target
 *   currently misconfigured by @bacons/apple-targets.
 */
// `@expo/config-plugins` lives in `expo`'s dependency tree. With pnpm's
// strict module isolation it isn't reliably resolvable from this file's
// own `node_modules` walk, so we resolve it through `expo` instead. This
// works across every package manager Expo supports and avoids declaring
// a redundant direct dev-dep on a transitive package.
const { createRequire } = require("node:module");
const path = require("node:path");

const expoPackageJson = require.resolve("expo/package.json", {
  paths: [path.join(__dirname, ".."), process.cwd()],
});
const expoRequire = createRequire(expoPackageJson);
const { withXcodeProject } = expoRequire("@expo/config-plugins");

const DEFAULT_TARGETS = ["LedgerWidget"];

/**
 * `xcode` stores target/config names in two flavours depending on whether
 * they contain spaces or quotes-worthy characters: either as the raw
 * string "Release" or wrapped like `"Release"`. Same with target names —
 * `"LedgerWidget"` vs `LedgerWidget`. Strip wrapping quotes once so we
 * can compare reliably.
 */
function unquote(value) {
  if (typeof value !== "string") return value;
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

module.exports = function withAppleTargetDistributionSigning(config, props) {
  const targetNames =
    Array.isArray(props?.targetNames) && props.targetNames.length > 0
      ? props.targetNames
      : DEFAULT_TARGETS;

  const teamId = config?.ios?.appleTeamId;
  if (!teamId) {
    // Without a team id we can't do useful manual signing. Let Xcode error
    // out the usual way rather than silently producing an unsigned target.
    console.warn(
      "[withAppleTargetDistributionSigning] expo.ios.appleTeamId is not set in app.json — skipping plugin.",
    );
    return config;
  }

  return withXcodeProject(config, (cfg) => {
    const proj = cfg.modResults;

    const nativeTargets = proj.pbxNativeTargetSection();
    const configLists = proj.pbxXCConfigurationList();
    const buildConfigs = proj.pbxXCBuildConfigurationSection();

    // The `xcode` package's section dicts contain alternating entries:
    // <uuid> -> object, and <uuid>_comment -> string. Filter to objects.
    const targetEntries = Object.entries(nativeTargets).filter(
      ([, value]) => typeof value === "object" && value !== null,
    );

    let patched = 0;
    for (const targetName of targetNames) {
      const match = targetEntries.find(
        ([, target]) => unquote(target.name) === targetName,
      );
      if (!match) {
        console.warn(
          `[withAppleTargetDistributionSigning] Target "${targetName}" not found — skipping. ` +
            "If this is unexpected, confirm @bacons/apple-targets is listed BEFORE this plugin in app.json.",
        );
        continue;
      }

      const [, target] = match;
      const list = configLists[target.buildConfigurationList];
      if (!list || !Array.isArray(list.buildConfigurations)) {
        console.warn(
          `[withAppleTargetDistributionSigning] Target "${targetName}" has no buildConfigurationList — skipping.`,
        );
        continue;
      }

      for (const ref of list.buildConfigurations) {
        const buildConfig = buildConfigs[ref.value];
        if (!buildConfig || unquote(buildConfig.name) !== "Release") continue;

        const settings = (buildConfig.buildSettings ||= {});
        settings.CODE_SIGN_STYLE = "Manual";
        settings.CODE_SIGN_IDENTITY = '"Apple Distribution"';
        settings["CODE_SIGN_IDENTITY[sdk=iphoneos*]"] = '"Apple Distribution"';
        settings.DEVELOPMENT_TEAM = teamId;
        // Leave PROVISIONING_PROFILE_SPECIFIER unset — EAS injects the
        // correct AppStore profile name from the credentials mapping
        // during its signing step. Forcing a value here would override
        // whatever EAS provisioned and bind us to a stale profile.
        patched += 1;
      }
    }

    if (patched === 0) {
      console.warn(
        "[withAppleTargetDistributionSigning] No Release configurations were patched. " +
          "Verify the target names match the actual native targets in the Xcode project.",
      );
    } else {
      console.log(
        `[withAppleTargetDistributionSigning] Patched ${patched} Release configuration(s) ` +
          `to Apple Distribution signing for: ${targetNames.join(", ")}.`,
      );
    }

    return cfg;
  });
};
