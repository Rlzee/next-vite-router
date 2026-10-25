import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../utils/logger";
import { getViteConfigPath } from "../utils/config-vite";
import {
  TEMPLATE_ENTRIES,
  startNextViteRouterConfig,
} from "../utils/start-next-vite-router-config";

type ConfigureOptions = {
  dir: string;
  src: boolean;
  tailwind?: boolean;
  yes?: boolean;
};

/**
 * Wire an existing Vite project instead of scaffolding a new one.
 *
 * `create` owns the interactive half of the CLI: prompts, create-vite, and
 * installs. This is the deterministic half, exposed as its own command so a
 * project that exists for any other reason can be configured in one step, and so
 * the file rewriting it performs is reachable without a network, a package
 * manager, or a TTY.
 */
export const configure = new Command()
  .name("configure")
  .description("Configure next-vite-router in an existing Vite project")
  .option("--dir <path>", "project directory to configure", ".")
  .option("--no-src", "read pages from a root-level app/ folder instead of src/app")
  .option("--tailwind", "install and wire @tailwindcss/vite (runs the package manager)")
  .option("--yes", "accept that an existing main.tsx is replaced")
  .action((options: ConfigureOptions) => {
    const projectDir = path.resolve(options.dir);

    const fail = (message: string) => {
      logger.error(message);
      process.exitCode = 1;
    };

    if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
      fail(`Project directory "${projectDir}" does not exist.`);
      return;
    }
    if (!getViteConfigPath(projectDir)) {
      fail(
        `No Vite config found in "${projectDir}". ` +
        "Run this inside a Vite project or pass --dir <path>.",
      );
      return;
    }

    const baseDir = path.join(projectDir, options.src ? "src" : ".");
    const entryPath = path.join(baseDir, "main.tsx");
    if (!options.yes && fs.existsSync(entryPath)) {
      fail(
        `"${entryPath}" already exists and configure replaces it with the router entry.\n` +
        "Re-run with --yes to let it be replaced, or keep your own entry and render <Router /> from \"next-vite-router/routes\" there.",
      );
      return;
    }

    logger.info(`Configuring next-vite-router in "${projectDir}"...`);
    const { pluginAdded } = startNextViteRouterConfig({
      projectDir,
      src: options.src,
      // Only requested explicitly, because it is the one step that installs.
      tailwindcss: Boolean(options.tailwind),
      // An existing project can hold real work: never delete from it.
      removeTemplateFiles: false,
    });

    if (!pluginAdded) {
      logger.warn(
        "vite.config already called nextViteRouter, so its options were left as they are. " +
        "Change pagesDir by hand when switching between src/app and a root-level app/.",
      );
    }

    const leftovers = TEMPLATE_ENTRIES.filter(
      (entryName) =>
        entryName !== "main.tsx" && fs.existsSync(path.join(baseDir, entryName)),
    );
    if (leftovers.length > 0) {
      logger.info(
        `Nothing was deleted. These template files are no longer imported and can be removed: ${leftovers.join(", ")}.`,
      );
    }

    logger.success(`\nnext-vite-router is configured in "${projectDir}".\n`);
    logger.log(
      `Add pages under ${options.src ? "src/app" : "app"} and start the dev server.`,
    );
  });
