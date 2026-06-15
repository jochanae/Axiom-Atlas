import { useEffect, useMemo, useRef } from "react";
import { autocompletion, closeBrackets, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { EditorState, type Extension } from "@codemirror/state";
import { searchKeymap } from "@codemirror/search";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";

type CodeEditorProps = {
  value: string;
  language: string;
  onChange: (next: string) => void;
};

function extensionForLanguage(language: string): Extension[] {
  const normalized = language.toLowerCase().trim();
  const extension = normalized.match(/\.([a-z0-9]+)$/)?.[1] ?? normalized.split(/\s+/).pop() ?? "";

  if (
    ["ts", "tsx", "js", "jsx", "typescript", "javascript"].includes(extension) ||
    normalized.includes("typescript") ||
    normalized.includes("javascript") ||
    normalized.includes("jsx") ||
    normalized.includes("tsx")
  ) {
    return [javascript({ typescript: true, jsx: true })];
  }
  if (extension === "css" || normalized.includes("css")) return [css()];
  if (extension === "html" || extension === "htm" || normalized.includes("html")) return [html()];
  if (extension === "json" || normalized.includes("json")) return [json()];
  return [];
}

const atlasEditorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "#0A0910",
      color: "rgba(240,238,232,0.9)",
      fontFamily: "var(--app-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: "inherit",
      fontSize: "12.5px",
      lineHeight: "1.65",
    },
    ".cm-content": {
      padding: "14px 0",
      caretColor: "var(--atlas-gold)",
    },
    ".cm-line": {
      padding: "0 16px 0 0",
    },
    ".cm-gutters": {
      backgroundColor: "#0A0910",
      color: "rgba(255,255,255,0.22)",
      border: "none",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      minWidth: "48px",
      padding: "0 14px 0 0",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(230,198,135,0.025)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(230,198,135,0.06)",
      color: "rgba(230,198,135,0.82)",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "rgba(230,198,135,0.22)",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--atlas-gold)",
    },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: "rgba(230,198,135,0.12)",
      outline: "1px solid rgba(230,198,135,0.28)",
    },
    ".cm-tooltip, .cm-panels": {
      backgroundColor: "#111018",
      border: "1px solid color-mix(in oklab, var(--atlas-gold) 20%, transparent)",
      color: "var(--atlas-fg)",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "rgba(230,198,135,0.16)",
      color: "var(--atlas-gold)",
    },
  },
  { dark: true },
);

export function CodeEditor({ value, language, onChange }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const languageExtensions = useMemo(() => extensionForLanguage(language), [language]);

  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          closeBrackets(),
          autocompletion(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          atlasEditorTheme,
          keymap.of([
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            ...searchKeymap,
          ]),
          ...languageExtensions,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      if (viewRef.current === view) viewRef.current = null;
    };
  }, [languageExtensions]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const current = view.state.doc.toString();
    if (current === value) return;

    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  return <div ref={hostRef} style={{ height: "100%", minHeight: 0, background: "#0A0910" }} />;
}
