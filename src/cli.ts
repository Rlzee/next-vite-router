#!/usr/bin/env node

import { Command } from "commander";
import { create } from "./command/create";
import { logger } from "./utils/logger";
import pkg from "../package.json" with { type: "json" };

async function main() {
  const program = new Command();
  // `create` is the whole CLI: prompts, create-vite, and installs. Wiring up a
  // project that already exists is left to the documented manual setup, so this
  // command is the only one the package publishes.
  program
    .name("next-vite-router")
    .version(pkg.version)
    .addCommand(create);
  // parseAsync awaits async actions, so errors surface here instead of as an
  // unhandled rejection with a raw stack trace.
  try {
    await program.parseAsync(process.argv);
  } catch (e) {
    logger.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

main();
