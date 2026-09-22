// argv parsing for `bb skill-manager`. Flags that take a value are listed
// explicitly; everything else is a boolean switch.
export interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  flags: Map<string, string | true>;
}

const VALUE_FLAGS: ReadonlySet<string> = new Set(["--to", "--from", "--source", "--page"]);

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    if (equals !== -1) {
      flags.set(arg.slice(0, equals), arg.slice(equals + 1));
    } else if (VALUE_FLAGS.has(arg) && index + 1 < argv.length) {
      flags.set(arg, argv[++index]);
    } else {
      flags.set(arg, true);
    }
  }
  const [command, ...rest] = positional;
  return { command, positional: rest, flags };
}

/** Comma-separated id list from a value flag, or undefined when absent. */
export function idList(flags: ParsedArgs["flags"], name: string): string[] | undefined {
  const value = flags.get(name);
  if (typeof value !== "string") return undefined;
  const ids = value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  return ids.length > 0 ? ids : undefined;
}

export function stringFlag(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}
