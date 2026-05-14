const MAX_DIM = 7000;
const MAX_BYTES = 4_500_000;

export async function fileToBase64Safe(
  file: File,
): Promise<{ base64: string; mediaType: string }> {
  if (!file.type.startsWith("image/")) {
    return readAsBase64(file);
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return readAsBase64(file);
  }
  const { width, height } = bitmap;
  const overSize = file.size > MAX_BYTES;
  const overDim = width > MAX_DIM || height > MAX_DIM;
  if (!overDim && !overSize) {
    bitmap.close();
    return readAsBase64(file);
  }
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return readAsBase64(file);
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();
  const outType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const quality = outType === "image/jpeg" ? 0.88 : undefined;
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("toBlob failed"))), outType, quality);
  });
  return readAsBase64(blob, outType);
}

function readAsBase64(blob: Blob, mediaTypeOverride?: string): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? "";
      resolve({ base64, mediaType: mediaTypeOverride ?? blob.type });
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}
