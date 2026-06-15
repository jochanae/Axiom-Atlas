import { useEffect, useId, useRef, useState } from "react";

const GLOSSARY_TIP_OPEN_EVENT = "atlas-glossary-tip-open";

interface GlossaryTipProps {
  term: string;
  children: string;
}

export function GlossaryTip({ term, children }: GlossaryTipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    const handleOtherTipOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string }>).detail;
      if (detail?.id !== id) setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener(GLOSSARY_TIP_OPEN_EVENT, handleOtherTipOpen);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener(GLOSSARY_TIP_OPEN_EVENT, handleOtherTipOpen);
    };
  }, [id, open]);

  const toggleOpen = () => {
    setOpen((current) => {
      if (current) return false;
      window.dispatchEvent(new CustomEvent(GLOSSARY_TIP_OPEN_EVENT, { detail: { id } }));
      return true;
    });
  };

  return (
    <span ref={rootRef} className="atlas-glossary-tip">
      <style>{`
        .atlas-glossary-tip {
          display: inline-block;
          position: relative;
        }

        .atlas-glossary-tip__term {
          appearance: none;
          background: transparent;
          border: 0;
          border-bottom: 1px dotted var(--atlas-gold);
          color: inherit;
          cursor: help;
          display: inline;
          font: inherit;
          letter-spacing: inherit;
          margin: 0;
          padding: 0 0 1px;
          text-align: inherit;
        }

        .atlas-glossary-tip__term:focus-visible {
          outline: 1px solid var(--atlas-gold);
          outline-offset: 3px;
        }

        .atlas-glossary-tip__popup {
          background: var(--atlas-surface);
          border: 1px solid var(--atlas-gold);
          border-radius: 8px;
          bottom: calc(100% + 8px);
          box-shadow: 0 12px 30px var(--atlas-shadow-md);
          color: var(--atlas-fg);
          font-family: var(--app-font-mono);
          font-size: 11px;
          left: 50%;
          line-height: 1.45;
          max-width: 220px;
          padding: 8px 12px;
          position: absolute;
          text-align: left;
          transform: translateX(-50%);
          white-space: normal;
          width: max-content;
          z-index: 1000;
        }

        @media (min-width: 768px) {
          .atlas-glossary-tip__popup {
            bottom: auto;
            top: calc(100% + 8px);
          }
        }
      `}</style>
      <span
        role="button"
        tabIndex={0}
        className="atlas-glossary-tip__term"
        aria-expanded={open}
        aria-describedby={open ? `${id}-tooltip` : undefined}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleOpen();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          toggleOpen();
        }}
      >
        {term}
      </span>
      {open && (
        <span id={`${id}-tooltip`} role="tooltip" className="atlas-glossary-tip__popup">
          {children}
        </span>
      )}
    </span>
  );
}

export default GlossaryTip;
