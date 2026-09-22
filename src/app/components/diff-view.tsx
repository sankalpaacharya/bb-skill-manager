import { cn } from "@/lib/utils";
import type { DiffResponse } from "../lib/types";

export function DiffView({ diff }: { diff: DiffResponse }) {
  if (diff.files.length === 0) return <p className="text-xs text-muted-foreground">No differences.</p>;
  return (
    <div className="max-h-80 overflow-auto rounded-md border border-border bg-surface-recessed p-3 font-mono text-xs">
      {diff.files.map((file) => (
        <div key={file.path} className="mb-3 last:mb-0">
          <div className="font-semibold">
            <span className="text-muted-foreground">{file.status}</span> {file.path}
          </div>
          {file.diff !== undefined ? (
            <pre className="mt-1 whitespace-pre-wrap">
              {file.diff.split("\n").map((line, index) => (
                <div
                  key={index}
                  className={cn(
                    line.startsWith("- ") && "text-destructive-text",
                    line.startsWith("+ ") && "text-success",
                    line === "@@" && "text-subtle-foreground",
                  )}
                >
                  {line}
                </div>
              ))}
            </pre>
          ) : null}
        </div>
      ))}
    </div>
  );
}
