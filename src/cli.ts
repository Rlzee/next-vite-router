#!/usr/bin/env node

import { Command } from "commander";
import { create } from "./command/create";
import { logger } from "./utils/logger";
import pkg from "../package.json" with { type: "json" };

async function main() {
  const program = new Command();
  program.name("next-vite-router").version(pkg.version).addCommand(create);
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
