import { execSync } from "node:child_process";

export type PmName = "pnpm" | "bun" | "yarn" | "npm";

/**
 * Try to run `--version` for a command to see if it's available.
 */
function isAvailable(cmd: string): boolean {
  try {
    // hide stdout/stderr
    execSync(`${cmd} --version`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to detect package manager from npm_config_user_agent env (set when run inside npm/pnpm/yarn)
 * Example values:
 *  - "pnpm/7.0.0 npm/? node/v18.0.0 linux x64"
 *  - "yarn/1.22.10 npm/? node/v16.13.0 linux x64"
 *  - "npm/8.1.0 node/v16.13.0 linux x64"
 */
function detectFromUserAgent(): PmName | null {
  const ua = process.env.npm_config_user_agent;
  if (!ua) return null;
  if (ua.startsWith("pnpm")) return "pnpm";
  if (ua.startsWith("bun")) return "bun";
  if (ua.startsWith("yarn")) return "yarn";
  if (ua.startsWith("npm")) return "npm";
  return null;
}

export interface PackageManager {
  name: PmName;
  // command string to create a new vite app with a specific template
  createProjectCommand: (projectName: string, template: string) => string;
  // command to install packages inside an existing project directory (package names appended)
  addDepsCommand: (deps: string[]) => string;
  // command to install dev deps
  addDevDepsCommand: (deps: string[]) => string;
  // recommended bootstrap / install command to run (no package names) after project creation
  installCommand: string;
}

/**
 * Main detector.
 * Order of precedence:
 * 1. npm_config_user_agent (when present)
 * 2. explicit env PREFERRED_PM (if set and available)
 * 3. check common CLIs in a preferred order: pnpm -> bun -> yarn -> npm
 */
export function detectPackageManager(): PackageManager {
  const preferred =
    (process.env.PREFERRED_PM as PmName | undefined) ?? undefined;

  const fromUA = detectFromUserAgent();
  const candidates: PmName[] = [];

  if (fromUA) candidates.push(fromUA);
  if (preferred && !candidates.includes(preferred)) candidates.push(preferred);

  ["pnpm", "bun", "yarn", "npm"].forEach((p) => {
    const pm = p as PmName;
    if (!candidates.includes(pm)) candidates.push(pm);
  });

  let chosen: PmName | null = null;
  for (const pm of candidates) {
    if (isAvailable(pm)) {
      chosen = pm;
      break;
    }
  }

  if (!chosen) {
    chosen = "npm";
  }

  switch (chosen) {
    case "pnpm":
      return {
        name: "pnpm",
        createProjectCommand: (projectName, template) =>
          `pnpm create vite@latest ${projectName} --template ${template} --no-rolldown`,
        addDepsCommand: (deps) => `pnpm add ${deps.join(" ")}`,
        addDevDepsCommand: (deps) => `pnpm add -D ${deps.join(" ")}`,
        installCommand: "pnpm install",
      };

    case "bun":
      return {
        name: "bun",
        createProjectCommand: (projectName, template) =>
          `bun create vite ${projectName} --template=${template} --no-rolldown`,
        addDepsCommand: (deps) => `bun add ${deps.join(" ")}`,
        addDevDepsCommand: (deps) => `bun add -d ${deps.join(" ")}`,
        installCommand: "bun install",
      };

    case "yarn":
      return {
        name: "yarn",
        createProjectCommand: (projectName, template) =>
          `yarn create vite ${projectName} --template=${template} --no-rolldown`,
        addDepsCommand: (deps) => `yarn add ${deps.join(" ")}`,
        addDevDepsCommand: (deps) => `yarn add -D ${deps.join(" ")}`,
        installCommand: "yarn install",
      };

    case "npm":
    default:
      return {
        name: "npm",
        createProjectCommand: (projectName, template) =>
          `npm create vite@latest ${projectName} -- --template ${template} --no-rolldown`,
        addDepsCommand: (deps) => `npm install ${deps.join(" ")}`,
        addDevDepsCommand: (deps) => `npm install -D ${deps.join(" ")}`,
        installCommand: "npm install",
      };
  }
}