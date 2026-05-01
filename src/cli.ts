#!/usr/bin/env node
import { Command } from "commander";
import { record } from "./record.js";
import { replay } from "./replay.js";
import { inspectTranscript } from "./inspect.js";
import { diffTranscriptFiles, formatDiff } from "./diff.js";
import { replayHttp } from "./http.js";
import { recordHttp } from "./record_http.js";

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

program
  .command("replay-http <file>")
  .description(
    "Serve a recorded transcript over HTTP. Single JSON request → single JSON response. SSE/streaming ships in v0.4.1.",
  )
  .option("--port <port>", "port to listen on (0 = random)", "8765")
  .option("--host <host>", "address to bind to", "127.0.0.1")
  .option("--path <path>", "URL path for the MCP endpoint", "/mcp")
  .action(
    async (
      file: string,
      opts: { port: string; host: string; path: string },
    ) => {
      const handle = await replayHttp({
        file,
        port: Number(opts.port),
        host: opts.host,
        path: opts.path,
      });
      process.stderr.write(
        `mcprec replay-http: listening on http://${opts.host}:${handle.port}${opts.path}\n`,
      );
      // Keep alive until SIGINT.
      const stop = async (): Promise<void> => {
        await handle.close();
        process.exit(0);
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    },
  );

program
  .command("record-http")
  .description(
    "Proxy an HTTP MCP endpoint, capturing every JSON-RPC frame (JSON or SSE) to a JSONL transcript",
  )
  .requiredOption("--out <file>", "transcript output path (JSONL)")
  .requiredOption("--target <url>", "target MCP HTTP endpoint")
  .option("--port <port>", "port to listen on (0 = random)", "8866")
  .option("--host <host>", "address to bind to", "127.0.0.1")
  .option("--path <path>", "URL path to proxy", "/mcp")
  .option(
    "--redact <patterns>",
    "comma-separated key patterns to redact (e.g. 'authorization,*_token')",
  )
  .action(
    async (opts: {
      out: string;
      target: string;
      port: string;
      host: string;
      path: string;
      redact?: string;
    }) => {
      const redact = opts.redact
        ? opts.redact.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      const handle = await recordHttp({
        out: opts.out,
        target: opts.target,
        port: Number(opts.port),
        host: opts.host,
        path: opts.path,
        redact,
      });
      process.stderr.write(
        `mcprec record-http: listening on http://${opts.host}:${handle.port}${opts.path} → ${opts.target}\n`,
      );
      const stop = async (): Promise<void> => {
        await handle.close();
        process.stderr.write(
          `mcprec record-http: captured ${handle.framesCaptured()} frames to ${opts.out}\n`,
        );
        process.exit(0);
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    },
  );

program
  .command("diff <a> <b>")
  .description(
    "Compare two transcripts. Surfaces method/params pairs that exist in only one and (method, params) pairs whose responses diverge.",
  )
  .option("--format <fmt>", "output format: text | json", "text")
  .action(async (a: string, b: string, opts: { format: string }) => {
    const diff = await diffTranscriptFiles(a, b);
    if (opts.format === "json") {
      process.stdout.write(JSON.stringify(diff, null, 2) + "\n");
    } else {
      process.stdout.write(formatDiff(diff, a, b) + "\n");
    }
    const drift = diff.onlyInA.length + diff.onlyInB.length + diff.changed.length;
    process.exit(drift > 0 ? 1 : 0);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${(err as Error).message ?? err}\n`);
  process.exit(1);
});
