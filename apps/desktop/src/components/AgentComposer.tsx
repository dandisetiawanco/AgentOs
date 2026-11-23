import React, { useRef } from "react";
import { Paperclip, Play, X } from "lucide-react";
import { Button } from "@agentos/ui";

export interface ComposerAttachment {
  name: string;
  size_bytes: number;
}

export interface AgentComposerProps {
  instruction: string;
  onInstructionChange: (value: string) => void;
  attachments: ComposerAttachment[];
  onAddAttachments: (files: ComposerAttachment[]) => void;
  onRemoveAttachment: (index: number) => void;
  submitting: boolean;
  onSubmit: (event: React.FormEvent) => void;
}

export function AgentComposer({
  instruction,
  onInstructionChange,
  attachments,
  onAddAttachments,
  onRemoveAttachment,
  submitting,
  onSubmit,
}: AgentComposerProps): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    onAddAttachments(files.map((f) => ({ name: f.name, size_bytes: f.size })));
    event.target.value = "";
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && instruction.trim()) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  };

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="glass-composer rounded-[16px] p-4 flex flex-col gap-3 focus-within:border-[var(--accent)] transition-[border-color,box-shadow] duration-200"
    >
      <label htmlFor="asst-instruction" className="visually-hidden">
        Instruction
      </label>
      <textarea
        id="asst-instruction"
        rows={3}
        required
        value={instruction}
        onChange={(e) => onInstructionChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe an authorized task (for example: Analyze workspace files, detect duplicates, or generate a verified report)"
        className="w-full resize-none bg-transparent border-0 px-1 py-0.5 type-body text-[var(--ink-primary)] placeholder:text-[var(--ink-secondary)] focus:outline-none"
      />

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          {attachments.map((att, idx) => (
            <span
              key={`${att.name}-${idx}`}
              className="inline-flex items-center gap-1.5 type-meta font-mono px-2.5 py-1 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-recessed)] text-[var(--ink-primary)]"
            >
              <span className="truncate max-w-[200px]">{att.name}</span>
              <button
                type="button"
                aria-label={`Remove attachment ${att.name}`}
                onClick={() => onRemoveAttachment(idx)}
                className="text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
              >
                <X className="w-3.5 h-3.5" aria-hidden={true} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-[var(--border-hairline)]">
        <div className="flex items-center gap-2.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="visually-hidden"
            aria-label="Attach files"
            onChange={handleFileChange}
          />
          <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Paperclip className="w-3.5 h-3.5" aria-hidden={true} />
            Attach file
          </Button>
          <span className="hidden sm:inline type-meta text-[var(--ink-secondary)]">
            <kbd className="font-mono px-1.5 py-0.5 rounded bg-[var(--surface-recessed)] border border-[var(--border-hairline)]">
              ⌘↵
            </kbd>{" "}
            to run
          </span>
        </div>

        <Button type="submit" variant="primary" size="md" loading={submitting}>
          <Play className="w-4 h-4" aria-hidden={true} />
          Plan & run
        </Button>
      </div>
    </form>
  );
}
