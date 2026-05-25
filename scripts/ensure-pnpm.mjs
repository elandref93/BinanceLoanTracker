import { rmSync } from "node:fs";

const userAgent = process.env.npm_config_user_agent ?? "";
const execPath = process.env.npm_execpath ?? "";
const isPnpm = /pnpm/i.test(userAgent) || /pnpm/i.test(execPath);

if (!isPnpm) {
  console.error(
    "This monorepo uses pnpm workspaces. Run `pnpm install` from the repository root (not npm or yarn).",
  );
  process.exit(1);
}

for (const lockfile of ["package-lock.json", "yarn.lock"]) {
  try {
    rmSync(lockfile, { force: true });
  } catch {
    // ignore
  }
}
