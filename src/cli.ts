#!/usr/bin/env node

import { Command } from "commander";
import { create } from "./command/create";
import { configure } from "./command/configure";
import { logger } from "./utils/logger";
import pkg from "../package.json" with { type: "json" };

async function main() {
  const program = new Command();
  // `create` scaffolds a project interactively; `configure` only wires up a
  // project that already exists, which is also the deterministic half of
  // `create` and therefore testable without a package manager or a TTY.
  program
    .name("next-vite-router")
    .version(pkg.version)
    .addCommand(create)
    .addCommand(configure);
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
