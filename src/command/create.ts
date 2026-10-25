import { Command } from "commander";
import { detectPackageManager } from "../utils/packageManager";
import { execSync } from "child_process";
import fs from "node:fs";
import path from "node:path";
import prompts from "prompts";
import { logger } from "../utils/logger";
import { startNextViteRouterConfig } from "../utils/start-next-vite-router-config";

// Letters, digits, ".", "_" and "-" only, so the name is safe to embed in the
// shell commands built below and cannot traverse outside the working directory.
const PROJECT_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

export const create = new Command()
  .name("create")
  .description(
    "Create a new Vite project with next-vite-router configuration"
  )
  .action(async () => {
    const projectNameResponse = await prompts(
      {
        type: "text",
        name: "projectName",
        message: "Enter your project name:",
        initial: "my-next-vite-router-app",
      },
      {
        onCancel: () => {
          logger.error("Project creation cancelled.");
          process.exit(1);
        },
      }
    );
    const projectName = projectNameResponse.projectName;

    if (!PROJECT_NAME_RE.test(projectName)) {
      logger.error(
        "Invalid project name (letters, digits, '.', '_' and '-' only)."
      );
      process.exitCode = 1;
      return;
    }
    if (fs.existsSync(path.resolve(projectName))) {
      logger.error(`Directory "${projectName}" already exists.`);
      process.exitCode = 1;
      return;
    }

    const variantResponse = await prompts(
      {
        type: "select",
        name: "template",
        message: "Select a template:",
        choices: [
          { title: "React + TypeScript (Recommended)", value: "react-ts" },
          {
            title: "React + TypeScript (React Compiler)",
            value: "react-compiler-ts",
          },
        ],
        initial: 0,
      },
      {
        onCancel: () => {
          logger.error("Template selection cancelled.");
          process.exit(1);
        },
      }
    );
    const variant = variantResponse.template;

    const srcFolderResponse = await prompts(
      {
        type: "confirm",
        name: "useSrc",
        message: "Do you want to use a 'src' folder?",
        initial: true,
      },
      {
        onCancel: () => {
          logger.error("Src folder selection cancelled.");
          process.exit(1);
        },
      }
    );
    const useSrc = srcFolderResponse.useSrc;

    const tailwindResponse = await prompts(
      {
        type: "confirm",
        name: "useTailwind",
        message: "Do you want to set up Tailwind CSS?",
        initial: true,
      },
      {
        onCancel: () => {
          logger.error("Tailwind CSS setup cancelled.");
          process.exit(1);
        },
      }
    );
    const useTailwind = tailwindResponse.useTailwind;

    const pm = detectPackageManager();
    const createCommand = pm.createProjectCommand(projectName, variant);
    logger.info(`Creating project "${projectName}" using ${pm.name}...`);


    execSync(createCommand, { stdio: "inherit" });

    logger.info("Installing dependencies...");
    execSync(pm.installCommand, { stdio: "inherit", cwd: projectName });

    logger.info(
      "Adding next-vite-router and react-router-dom as dependencies..."
    );
    const addDepsCmd = pm.addDepsCommand([
      "next-vite-router",
      "react-router-dom@^7.0.0",
    ]);
    execSync(addDepsCmd, { stdio: "inherit", cwd: projectName });

    logger.info("Configuring next-vite-router in the project...");
    startNextViteRouterConfig({
      projectDir: `./${projectName}`,
      src: useSrc,
      tailwindcss: useTailwind,
    });

    logger.success(`\nProject "${projectName}" is ready!\n`);
  });
