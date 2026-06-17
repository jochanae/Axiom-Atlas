import { useEffect, useRef, useState } from "react";
import type React from "react";

function StreamingText({
  text,
  speed = 35,
  animate = true,
  onComplete,
  onVisibleTextChange,
  style,
}: {
  text: string;
  speed?: number;
  animate?: boolean;
  onComplete?: () => void;
  onVisibleTextChange?: (visibleText: string) => void;
  style?: React.CSSProperties;
}) {
  const [visibleCount, setVisibleCount] = useState(animate ? 0 : Infinity);
  const words = useRef<string[]>([]);
  const completeCalled = useRef(false);

  useEffect(() => {
    words.current = text.match(/\S+|\n/g) ?? [];
    if (!animate) { setVisibleCount(Infinity); return; }
    setVisibleCount(0);
    completeCalled.current = false;
  }, [text, animate]);

  useEffect(() => {
    if (!animate) return;
    const total = words.current.length;
    if (visibleCount >= total) {
      if (!completeCalled.current) { completeCalled.current = true; onComplete?.(); }
      return;
    }
    const lastWord = words.current[visibleCount - 1] ?? "";
    const pause = /[.!?]$/.test(lastWord)
      ? speed * 4
      : speed * (0.6 + Math.random() * 0.8);
    const timer = setTimeout(() => {
      const burst = Math.random() > 0.7 ? 2 : 1;
      setVisibleCount((c) => Math.min(c + burst, total));
    }, pause);
    return () => clearTimeout(timer);
  }, [visibleCount, animate, speed, onComplete]);

  const done = !animate || visibleCount >= (words.current.length || Infinity);
  const visible = done ? text : words.current.slice(0, visibleCount).join(" ");
  useEffect(() => {
    onVisibleTextChange?.(visible);
  }, [visible, onVisibleTextChange]);

  if (done) {
    return <div style={style}>{text}</div>;
  }
  return (
    <div style={style}>
      {visible}
      <span className="atlas-cursor" />
    </div>
  );
}

function splitIntoChunks(text: string): string[] {
  if (text.length < 300) return [text];
  const raw = text.split(/\n{2,}/);
  const chunks: string[] = [];
  for (const segment of raw) {
    const trimmed = segment.trim();
    if (trimmed) chunks.push(trimmed);
  }
  return chunks.length > 0 ? chunks : [text];
}

function ChunkedBubbles({
  text,
  isNew,
  textStyle,
  onStreamTextChange,
  onComplete,
}: {
  text: string;
  isNew: boolean;
  textStyle?: React.CSSProperties;
  onStreamTextChange?: (visibleText: string) => void;
  onComplete?: () => void;
}) {
  const chunks = splitIntoChunks(text);
  const [revealed, setRevealed] = useState(isNew ? 0 : chunks.length);
  const completedRef = useRef(false);

  useEffect(() => {
    if (!isNew || revealed >= chunks.length) return;
    const timer = setTimeout(
      () => setRevealed((r) => r + 1),
      revealed === 0 ? 100 : 600 + Math.random() * 400,
    );
    return () => clearTimeout(timer);
  }, [revealed, chunks.length, isNew]);

  useEffect(() => {
    completedRef.current = false;
  }, [text, isNew]);

  const visibleChunks = chunks.slice(0, isNew ? Math.min(revealed + 1, chunks.length) : chunks.length);
  return (
    <>
      {visibleChunks.map((chunk, i) => (
        <StreamingText
          key={i}
          text={chunk}
          animate={isNew && i === revealed && revealed < chunks.length}
          onVisibleTextChange={(visible) => {
            if (!isNew) return;
            onStreamTextChange?.([...chunks.slice(0, i), visible].join("\n\n"));
          }}
          onComplete={() => {
            if (!isNew || i !== chunks.length - 1 || completedRef.current) return;
            completedRef.current = true;
            onComplete?.();
          }}
          style={{ ...textStyle, ...(i < visibleChunks.length - 1 ? { marginBottom: 12 } : {}) }}
        />
      ))}
    </>
  );
}

export { StreamingText, ChunkedBubbles };
