// Use Sentry's Expo Metro wrapper so production bundles emit the source maps
// Sentry needs to symbolicate native + JS stack traces. It delegates to
// expo/metro-config under the hood, so it is a drop-in for getDefaultConfig.
const path = require("path");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
// Expo's default workspace-root mode serves bundles under this prefix.
// The Ledger development client may request the unprefixed path instead.
const NESTED_PREFIX = "/artifacts/ledger-mobile";

const config = getSentryExpoConfig(projectRoot);

config.watchFolders = Array.from(
  new Set([...(config.watchFolders || []), workspaceRoot]),
);

config.resolver.nodeModulesPaths = [
  ...(config.resolver.nodeModulesPaths || []),
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// pnpm gives api-client-react its own @tanstack/react-query built against
// catalog React 19.1.0, while this app uses React 19.2.3. Hierarchical lookup
// from lib/api-client-react then loads a second React / QueryClient context
// and the dashboard dies with "Invalid hook call" / "useContext of null".
const singletonNames = [
  "react",
  "react-dom",
  "react-native",
  "@tanstack/react-query",
];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-dom": path.resolve(projectRoot, "node_modules/react-dom"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
  "@tanstack/react-query": path.resolve(
    projectRoot,
    "node_modules/@tanstack/react-query",
  ),
};

const previousResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isSingleton = singletonNames.some(
    (name) => moduleName === name || moduleName.startsWith(`${name}/`),
  );
  const nextContext = isSingleton
    ? {
        ...context,
        originModulePath: path.join(projectRoot, "package.json"),
      }
    : context;
  if (typeof previousResolveRequest === "function") {
    return previousResolveRequest(nextContext, moduleName, platform);
  }
  return nextContext.resolveRequest(nextContext, moduleName, platform);
};

config.server = config.server || {};
const prevRewrite = config.server.rewriteRequestUrl;
config.server.rewriteRequestUrl = (url) => {
  const rewritten = typeof prevRewrite === "function" ? prevRewrite(url) : url;
  const q = rewritten.indexOf("?");
  const pathname = q === -1 ? rewritten : rewritten.slice(0, q);
  const search = q === -1 ? "" : rewritten.slice(q);

  let nextPath = pathname;
  // Project-root Metro (EXPO_NO_METRO_WORKSPACE_ROOT) serves unprefixed
  // paths. Accept the older monorepo-prefixed URLs too.
  if (nextPath === NESTED_PREFIX || nextPath.startsWith(`${NESTED_PREFIX}/`)) {
    nextPath = nextPath.slice(NESTED_PREFIX.length) || "/";
  }
  if (nextPath === "/index.bundle" || nextPath === "/index.exp.bundle") {
    nextPath = "/node_modules/expo-router/entry.bundle";
  }
  return `${nextPath}${search}`;
};

module.exports = config;
