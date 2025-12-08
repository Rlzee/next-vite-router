import { Command } from "commander";
import { detectPackageManager } from "../utils/packageManager";
import { execSync } from "child_process";
import prompts from "prompts";
import { logger } from "../utils/logger";
import { startNextViteRouterConfig } from "../utils/start-next-vite-router-config";

const pm = detectPackageManager();

export const init = new Command()
  .name("init")
  .description(
    "Initialize a new Vite project with next-vite-router configuration"
  )
  .action(async () => {
    // Prompt for project name
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

    // Prompt for template selection
    const variantResponse = await prompts(
      {
        type: "select",
        name: "template",
        message: "Select a template:",
        choices: [
          { title: "React + TypeScript", value: "react-ts" },
          {
            title: "React + TypeScript (React Compiler)",
            value: "react-compiler-ts",
          },
          { title: "React + SWC (Recommended)", value: "react-swc-ts" },
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

    // Prompt for src folder usage
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

    // Prompt for Tailwind CSS setup
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

    // Create the project using the detected package manager
    const createCommand = pm.createProjectCommand(projectName, variant);
    logger.info(`Creating project "${projectName}" using ${pm.name}...`);

    try {
      // Use input option to automatically answer 'n' to the install prompt
      execSync(createCommand, {
        stdio: ["pipe", "inherit", "inherit"],
        input: "n\n",
      });
    } catch (error) {
      // Ignore errors from answering 'n' to the prompt
    }

    // Install dependencies manually
    logger.info("Installing dependencies...");
    execSync(pm.installCommand, { stdio: "inherit", cwd: projectName });

    // Install next-vite-router and react-router-dom as dependencies
    logger.info(
      "Adding next-vite-router and react-router-dom as dependencies..."
    );
    const addDepsCmd = pm.addDepsCommand([
      "next-vite-router",
      "react-router-dom@latest",
    ]);
    execSync(addDepsCmd, { stdio: "inherit", cwd: projectName });

    // Configure next-vite-router (modifies vite.config)
    logger.info("Configuring next-vite-router in the project...");
    startNextViteRouterConfig({
      projectDir: `./${projectName}`,
      src: useSrc,
      tailwindcss: useTailwind,
    });

    logger.success(`\nProject "${projectName}" is ready!\n`);
  });
