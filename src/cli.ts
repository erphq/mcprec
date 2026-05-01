#!/usr/bin/env node
import { Command } from "commander";
import { record } from "./record.js";
import { replay } from "./replay.js";
import { inspectTranscript } from "./inspect.js";

const program = new Command();

program
  .name("mcprec")
  .description("Record & replay any MCP server")
  .version("0.1.0");

program
  .command("record")
  .description("Run an MCP server and capture every JSON-RPC frame to a transcript")
  .requiredOption("--out <file>", "transcript output path (JSONL)")
  .option(
    "--redact <patterns>",
    "comma-separated key patterns to redact (e.g. 'authorization,*_token')",
  )
  .argument("<command...>", "the MCP server command to run")
  .action(
    async (
      command: string[],
      opts: { out: string; redact?: string },
    ) => {
      const redact = opts.redact
        ? opts.redact.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      await record({ command, out: opts.out, redact });
    },
  );

program
  .command("replay <file>")
  .description("Replay a recorded transcript as a fake MCP server (stdio)")
  .action(async (file: string) => {
    await replay({ file });
  });

program
  .command("inspect <file>")
  .description("Pretty-print a transcript")
  .action(async (file: string) => {
    const out = await inspectTranscript(file);
    process.stdout.write(out + "\n");
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${(err as Error).message ?? err}\n`);
  process.exit(1);
});
