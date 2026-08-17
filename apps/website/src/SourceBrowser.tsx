import { useState } from "react";
import { Prism } from "./prism";

const CODE_TOKEN_CLASSES =
  "font-mono text-[13px] leading-6 text-ink [&_.token.boolean]:text-[#79c0ff] [&_.token.builtin]:text-[#ffa657] [&_.token.class-name]:text-[#ffa657] [&_.token.comment]:text-[#8b949e] [&_.token.function]:text-[#d2a8ff] [&_.token.keyword]:text-[#ff7b72] [&_.token.number]:text-[#79c0ff] [&_.token.operator]:text-[#ff7b72] [&_.token.property]:text-[#79c0ff] [&_.token.punctuation]:text-[#c9d1d9] [&_.token.string]:text-[#a5d6ff] [&_.token.variable]:text-[#ffa657]";

function highlightCode(fileName: string, code: string): string {
  if (/\.json$/iu.test(fileName) && Prism.languages.json) {
    return Prism.highlight(code, Prism.languages.json, "json");
  }
  if (/\.[cm]?[tj]sx?$/iu.test(fileName) && Prism.languages.typescript) {
    return Prism.highlight(code, Prism.languages.typescript, "typescript");
  }
  return code
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function preferredSourceFile(
  files: Array<{ file_name: string; code: string }>,
): string {
  const preferred =
    files.find((file) => /^index\.[cm]?[tj]sx?$/iu.test(file.file_name)) ??
    files.find((file) => /\.[cm]?[tj]sx?$/iu.test(file.file_name)) ??
    files[0];
  return preferred?.file_name ?? "";
}

export function SourceBrowser({
  files,
}: {
  files: Array<{ file_name: string; code: string }>;
}) {
  const [activeFile, setActiveFile] = useState(() => preferredSourceFile(files));
  const active = files.find((file) => file.file_name === activeFile) ?? files[0];
  if (!active) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-rule bg-panel shadow-[0_0_24px_rgba(18,206,65,0.05)]">
      <div className="flex flex-col lg:grid lg:min-h-[440px] lg:grid-cols-[180px_minmax(0,1fr)]">
        <nav
          aria-label="Source files"
          className="flex gap-1 overflow-x-auto border-b border-rule bg-black/25 p-2 [scrollbar-width:none] lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-r lg:border-b-0 [&::-webkit-scrollbar]:hidden"
        >
          {files.map((file) => {
            const selected = file.file_name === active.file_name;
            return (
              <button
                key={file.file_name}
                type="button"
                title={file.file_name}
                onClick={() => setActiveFile(file.file_name)}
                className={`shrink-0 rounded-md px-3 py-1.5 text-left font-mono text-xs transition lg:w-full lg:min-w-0 lg:max-w-full lg:overflow-hidden lg:py-2 ${
                  selected
                    ? "bg-accent/10 text-accent-bright shadow-[inset_0_0_0_1px_rgba(18,206,65,0.18)]"
                    : "text-muted hover:bg-white/4 hover:text-ink"
                }`}
              >
                <span className="block truncate">{file.file_name}</span>
              </button>
            );
          })}
        </nav>
        <pre className="max-h-[min(60vh,28rem)] overflow-auto bg-[#0f120f] p-4 lg:max-h-none [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]">
          <code
            className={CODE_TOKEN_CLASSES}
            dangerouslySetInnerHTML={{
              __html: highlightCode(active.file_name, active.code),
            }}
          />
        </pre>
      </div>
    </div>
  );
}
