#!/usr/bin/env node

import { Command } from "commander";
import { init } from "./command/init";
import pkg from "../package.json" assert { type: "json" };

async function main() {
  const program = new Command();
  program.name("create-next-vite-router").version(pkg.version).addCommand(init);
  // Parse CLI args once after commands are registered
  program.parse(process.argv);
}

main();