import React from "react";

interface ResearchCardProps {
  url: string;
  title: string;
  summary: string | null;
  headings: string[];
}

export function ResearchCard({ url, title, summary, headings }: ResearchCardProps) {
  const domain = (() => {
    try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
  })();

  return (
    <div style={{ background: "rgba(28,25,23,0.85)", border: "1px solid rgba(201,162,76,0.25)", borderRadius: "10px", padding: "14px 16px", marginTop: "10px", maxWidth: "520px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
        <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`} alt="" width={16} height={16} style={{ borderRadius: "3px", opacity: 0.85 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        <span style={{ color: "#C9A24C", fontWeight: 600, fontSize: "13px" }}>Research</span>
        <span style={{ color: "#78716C", fontSize: "12px" }}>·</span>
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#78716C", fontSize: "12px", textDecoration: "none" }}>{domain}</a>
      </div>
      <p style={{ color: "#E7E5E4", fontSize: "14px", fontWeight: 600, margin: "0 0 8px" }}>{title}</p>
      {summary && <p style={{ color: "#A8A29E", fontSize: "13px", lineHeight: 1.55, margin: "0 0 10px" }}>{summary}</p>}
      {headings.length > 0 && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "8px" }}>
          <p style={{ color: "#78716C", fontSize: "11px", margin: "0 0 5px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Key sections</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
            {headings.map((h, i) => (
              <span key={i} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "2px 7px", color: "#A8A29E", fontSize: "11px" }}>{h}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
