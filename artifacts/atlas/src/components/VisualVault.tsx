import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";

interface GalleryImage {
  id: number;
  objectPath: string;
  label: string | null;
  createdAt: string;
  projectId: number | null;
}

interface VisualVaultProps {
  projectId?: number | null;
  onClose: () => void;
}

function compressVaultImage(source: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(source);
    img.onload = () => {
      try {
        URL.revokeObjectURL(url);
        const MAX = 800;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round((height * MAX) / width); width = MAX; }
          else { width = Math.round((width * MAX) / height); height = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("canvas unavailable")); return; }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error("compression failed")); return; }
          resolve(blob);
        }, "image/jpeg", 0.75);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
    img.src = url;
  });
}

export function VisualVault({ projectId, onClose }: VisualVaultProps) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [lightbox, setLightbox] = useState<GalleryImage | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchImages = useCallback(async () => {
    try {
      const url = projectId
        ? `/api/gallery?projectId=${projectId}`
        : `/api/gallery`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json() as { images: GalleryImage[] };
      setImages(data.images);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchImages(); }, [fetchImages]);

  const saveCompressedImage = useCallback(async (source: Blob, name: string, label: string) => {
    const compressed = await compressVaultImage(source);
    const uploadName = `${name.replace(/\.[^/.]+$/, "") || "vault-image"}.jpg`;

    const urlRes = await fetch("/api/gallery/request-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name: uploadName, size: compressed.size, contentType: "image/jpeg" }),
    });
    if (!urlRes.ok) throw new Error("URL request failed");
    const { uploadURL, objectPath } = await urlRes.json() as { uploadURL: string; objectPath: string };

    const uploadRes = await fetch(uploadURL, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: compressed,
    });
    if (!uploadRes.ok) throw new Error("Upload failed");

    const saveRes = await fetch("/api/gallery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        objectPath,
        label,
        projectId: projectId ?? null,
      }),
    });
    if (!saveRes.ok) throw new Error("Save failed");
  }, [projectId]);

  const handleFiles = useCallback(async (files: File[]) => {
    const images = files.filter(f => f.type.startsWith("image/")).slice(0, 10);
    if (!images.length) { toast("Select image files to upload"); return; }
    setUploading(true);
    setUploadProgress(0);
    let done = 0;
    for (const file of images) {
      try {
        await saveCompressedImage(file, file.name, file.name.replace(/\.[^/.]+$/, ""));
        done++;
        setUploadProgress(Math.round((done / images.length) * 100));
      } catch {
        toast(`Failed to upload ${file.name}`);
      }
    }
    await fetchImages();
    setUploading(false);
    setUploadProgress(0);
    if (done > 0) toast(`${done} image${done > 1 ? "s" : ""} saved to vault`);
  }, [fetchImages, saveCompressedImage]);

  const handleDelete = useCallback(async (id: number) => {
    try {
      await fetch(`/api/gallery/${id}`, { method: "DELETE", credentials: "include" });
      setImages(prev => prev.filter(i => i.id !== id));
      if (lightbox?.id === id) setLightbox(null);
    } catch {
      toast("Could not delete image");
    }
  }, [lightbox]);

  const handleCapture = useCallback(async () => {
    const url = urlInput.trim();
    if (!url) return;
    const withProtocol = url.startsWith("http") ? url : `https://${url}`;
    setCaptureError(null);
    setCapturing(true);
    try {
      const microlinkURL =
        `https://api.microlink.io/?url=${encodeURIComponent(withProtocol)}` +
        `&screenshot=true&fullPage=true&meta=false&embed=screenshot.url`;
      const res = await fetch(microlinkURL);
      const data = await res.json() as {
        status?: string;
        data?: { screenshot?: { url?: string } };
        error?: string;
      };
      const screenshotUrl = data?.data?.screenshot?.url;
      if (!res.ok || !screenshotUrl) {
        setCaptureError(data.error ?? "Capture failed — check the URL and try again");
        return;
      }
      const imgRes = await fetch(screenshotUrl);
      if (!imgRes.ok) {
        setCaptureError("Failed to download screenshot");
        return;
      }
      const hostname = (() => { try { return new URL(withProtocol).hostname.replace(/^www\./, ""); } catch { return "Captured page"; } })();
      await saveCompressedImage(await imgRes.blob(), `${hostname}.jpg`, hostname);
      setUrlInput("");
      await fetchImages();
      toast("Page captured and saved to vault");
    } catch {
      setCaptureError("Network error — try again");
    } finally {
      setCapturing(false);
    }
  }, [urlInput, fetchImages, saveCompressedImage]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(Array.from(e.dataTransfer.files));
  }, [handleFiles]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "var(--atlas-bg)",
          zIndex: 900, backdropFilter: "blur(4px)",
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: "fixed", inset: "0 0 0 0",
          display: "flex", flexDirection: "column",
          zIndex: 901,
          pointerEvents: "none",
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          style={{
            width: "100%", maxWidth: 560,
            maxHeight: "88vh",
            background: "var(--atlas-surface)",
            borderRadius: "18px 18px 0 0",
            border: "1px solid rgba(201,162,76,0.18)",
            borderBottom: "none",
            display: "flex", flexDirection: "column",
            pointerEvents: "all",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div style={{
            padding: "18px 20px 14px",
            borderBottom: "1px solid rgba(201,162,76,0.1)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexShrink: 0,
          }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "var(--atlas-gold)", opacity: 0.7, textTransform: "uppercase", fontFamily: "var(--app-font-mono)", marginBottom: 3 }}>
                {projectId ? "Project Gallery" : "Global Gallery"}
              </div>
              <div style={{ fontSize: 17, fontWeight: 500, color: "var(--atlas-fg)", letterSpacing: "0.02em" }}>
                Visual Vault
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={{
                  padding: "7px 14px",
                  borderRadius: 8,
                  background: uploading ? "rgba(201,162,76,0.08)" : "rgba(201,162,76,0.13)",
                  border: "1px solid rgba(201,162,76,0.3)",
                  color: "var(--atlas-gold)",
                  fontSize: 12, fontWeight: 600,
                  cursor: uploading ? "not-allowed" : "pointer",
                  fontFamily: "var(--app-font-mono)",
                  letterSpacing: "0.06em",
                  display: "flex", alignItems: "center", gap: 5,
                  opacity: uploading ? 0.6 : 1,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1v7M3 4l3-3 3 3M1 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {uploading ? `${uploadProgress}%` : "Upload"}
              </button>
              <button
                onClick={onClose}
                style={{
                  width: 30, height: 30, borderRadius: "50%",
                  background: "var(--atlas-fg)",
                  border: "1px solid var(--atlas-fg)",
                  color: "var(--atlas-muted)", fontSize: 16, lineHeight: 1,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >×</button>
            </div>
          </div>

          {/* Upload progress bar */}
          {uploading && (
            <div style={{ height: 2, background: "rgba(201,162,76,0.08)", flexShrink: 0 }}>
              <div style={{ height: "100%", width: `${uploadProgress}%`, background: "var(--atlas-gold)", transition: "width 0.3s ease" }} />
            </div>
          )}

          {/* URL capture bar */}
          <div style={{ padding: "10px 16px 0", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
              <input
                type="url"
                value={urlInput}
                onChange={e => { setUrlInput(e.target.value); setCaptureError(null); }}
                onKeyDown={e => e.key === "Enter" && !capturing && handleCapture()}
                placeholder="Paste a URL to capture full-page screenshot"
                disabled={capturing}
                style={{
                  flex: 1,
                  background: "var(--atlas-glass-bg)",
                  border: "1px solid rgba(201,162,76,0.2)",
                  borderRadius: 8,
                  padding: "8px 11px",
                  fontSize: 12,
                  color: "var(--atlas-fg)",
                  fontFamily: "var(--app-font-mono)",
                  outline: "none",
                  opacity: capturing ? 0.6 : 1,
                }}
              />
              <button
                onClick={handleCapture}
                disabled={!urlInput.trim() || capturing}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  background: capturing ? "rgba(201,162,76,0.08)" : "rgba(201,162,76,0.15)",
                  border: "1px solid rgba(201,162,76,0.35)",
                  color: "var(--atlas-gold)",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "var(--app-font-mono)",
                  letterSpacing: "0.06em",
                  cursor: !urlInput.trim() || capturing ? "not-allowed" : "pointer",
                  opacity: !urlInput.trim() || capturing ? 0.5 : 1,
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  flexShrink: 0,
                }}
              >
                {capturing ? (
                  <>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", border: "1.5px solid rgba(201,162,76,0.3)", borderTopColor: "var(--atlas-gold)", animation: "spin 0.8s linear infinite" }} />
                    Capturing
                  </>
                ) : "Capture"}
              </button>
            </div>
            {captureError && (
              <div style={{ fontSize: 10, color: "var(--atlas-ember)", fontFamily: "var(--app-font-mono)", marginTop: 5, paddingLeft: 2 }}>
                {captureError}
              </div>
            )}
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 20px" }}>
            {loading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid rgba(201,162,76,0.2)", borderTopColor: "var(--atlas-gold)", animation: "spin 0.8s linear infinite" }} />
              </div>
            ) : images.length === 0 ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: "1.5px dashed rgba(201,162,76,0.2)",
                  borderRadius: 12,
                  padding: "40px 24px",
                  textAlign: "center",
                  cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                }}
              >
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <path d="M14 3v16M7 10l7-7 7 7M3 23h22" stroke="rgba(201,162,76,0.5)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <div style={{ fontSize: 14, color: "var(--atlas-muted)", fontFamily: "var(--app-font-sans)" }}>
                  Tap to upload images
                </div>
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.55, fontFamily: "var(--app-font-mono)", letterSpacing: "0.05em" }}>
                  Screenshots, designs, wireframes
                </div>
              </div>
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8,
              }}>
                {images.map(img => (
                  <div
                    key={img.id}
                    style={{ position: "relative", aspectRatio: "1", borderRadius: 8, overflow: "hidden", cursor: "pointer" }}
                    onClick={() => setLightbox(img)}
                  >
                    <img
                      src={`/api/storage${img.objectPath}`}
                      alt={img.label ?? "gallery image"}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      loading="lazy"
                    />
                    {img.label && (
                      <div style={{
                        position: "absolute", bottom: 0, left: 0, right: 0,
                        background: "linear-gradient(transparent, var(--atlas-bg))",
                        padding: "12px 6px 5px",
                        fontSize: 9,
                        color: "var(--atlas-fg)",
                        fontFamily: "var(--app-font-mono)",
                        letterSpacing: "0.04em",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {img.label}
                      </div>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(img.id); }}
                      style={{
                        position: "absolute", top: 4, right: 4,
                        width: 20, height: 20, borderRadius: "50%",
                        background: "var(--atlas-bg)",
                        border: "1px solid var(--atlas-fg)",
                        color: "var(--atlas-fg)",
                        fontSize: 11, lineHeight: 1,
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >×</button>
                  </div>
                ))}
                {/* Add more button */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    aspectRatio: "1",
                    borderRadius: 8,
                    border: "1.5px dashed rgba(201,162,76,0.18)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer",
                    background: "rgba(201,162,76,0.03)",
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M10 4v12M4 10h12" stroke="rgba(201,162,76,0.5)" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>
            )}
          </div>

          {/* Image count footer */}
          {images.length > 0 && (
            <div style={{
              padding: "10px 20px 16px",
              fontSize: 10, color: "var(--atlas-muted)", opacity: 0.5,
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
              textAlign: "center", flexShrink: 0,
              borderTop: "1px solid rgba(201,162,76,0.07)",
            }}>
              {images.length} image{images.length !== 1 ? "s" : ""} · tap to enlarge
            </div>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "var(--atlas-bg)",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            padding: 20,
          }}
        >
          <button
            onClick={() => setLightbox(null)}
            style={{
              position: "absolute", top: 20, right: 20,
              width: 36, height: 36, borderRadius: "50%",
              background: "var(--atlas-surface)",
              border: "1px solid rgba(201,162,76,0.2)",
              color: "var(--atlas-fg)", fontSize: 18,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >×</button>
          <img
            src={`/api/storage${lightbox.objectPath}`}
            alt={lightbox.label ?? ""}
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: "100%", maxHeight: "85vh",
              borderRadius: 10,
              objectFit: "contain",
            }}
          />
          {lightbox.label && (
            <div style={{
              marginTop: 12, fontSize: 12,
              color: "var(--atlas-muted)",
              fontFamily: "var(--app-font-mono)",
              letterSpacing: "0.06em",
            }}>
              {lightbox.label}
            </div>
          )}
          <button
            onClick={e => { e.stopPropagation(); handleDelete(lightbox.id); }}
            style={{
              marginTop: 16,
              padding: "7px 18px", borderRadius: 8,
              background: "rgba(146,64,14,0.15)",
              border: "1px solid rgba(146,64,14,0.4)",
              color: "var(--atlas-fg)",
              fontSize: 11, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
              cursor: "pointer",
            }}
          >Remove from vault</button>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        style={{ display: "none" }}
        onChange={e => {
          handleFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
