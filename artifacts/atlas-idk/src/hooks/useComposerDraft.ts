import { useState, useRef } from "react";

/**
 * useComposerDraft
 *
 * Composer-local draft state for the chat input. Owns ONLY the values that are
 * read/written exclusively by the composer surface:
 *   - input text + setter
 *   - attached files + setter
 *   - textarea ref + file input ref
 *   - focus flag
 *   - first-run gate (dismissed flag + buffered first input)
 *
 * Does NOT own messages, sessionId, lens/model, ZIP state, or any API calls —
 * those remain in workspace.tsx for now and will move in later slices.
 *
 * `projectId` is accepted (and ignored for now) so future slices can scope
 * persistence by project without changing the call sites.
 */
export function useComposerDraft(_projectId?: number) {
  const [input, setInput] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [inputFocused, setInputFocused] = useState(false);
  const [firstRunDismissed, setFirstRunDismissed] = useState(false);
  const [firstRunInput, setFirstRunInput] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return {
    input,
    setInput,
    attachedFiles,
    setAttachedFiles,
    inputFocused,
    setInputFocused,
    firstRunDismissed,
    setFirstRunDismissed,
    firstRunInput,
    setFirstRunInput,
    textareaRef,
    fileInputRef,
  };
}
