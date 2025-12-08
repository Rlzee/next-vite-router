import { Command } from "commander";
import { init } from "./command/init";

async function main() {
  const program = new Command();
  program.name("next-vite-router").version("1.0.5").addCommand(init);

  // Parse CLI args once after commands are registered
  program.parse(process.argv);
}

main();
