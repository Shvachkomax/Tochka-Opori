// Adaptive photo compression for diary uploads.
// Compresses images to fit within a target total request budget.

const DEFAULT_BUDGET_BYTES = 3 * 1024 * 1024; // 3 MB for photos (headroom for JSON metadata)
const DEFAULT_MAX_DIMENSION = 1280;
const DEFAULT_QUALITY = 0.72;
const MIN_QUALITY = 0.35;
const MAX_PHOTOS = 6;

export function getImageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

export function compressImage(dataUrl, { maxWidth = DEFAULT_MAX_DIMENSION, maxHeight = DEFAULT_MAX_DIMENSION, quality = DEFAULT_QUALITY } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const ratio = Math.min(1, maxWidth / width, maxHeight / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      const isPng = dataUrl.startsWith("data:image/png");
      const outputType = isPng ? "image/jpeg" : "image/jpeg"; // Always JPEG for size control
      resolve(canvas.toDataURL(outputType, quality));
    };
    img.onerror = () => reject(new Error("Failed to load image for compression"));
    img.src = dataUrl;
  });
}

export function estimateDataUrlBytes(dataUrl) {
  // data URL overhead: "data:image/jpeg;base64," = 23 chars; base64 encodes 3 bytes → 4 chars
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) return dataUrl.length;
  const base64Length = dataUrl.length - commaIndex - 1;
  return Math.floor(base64Length * 3 / 4);
}

export async function compressPhotosToBudget(photos, budgetBytes = DEFAULT_BUDGET_BYTES, baseBytes = 0) {
  if (!Array.isArray(photos) || photos.length === 0) return { photos: [], totalBytes: 0, compressed: 0, truncated: false };

  const truncated = photos.length > MAX_PHOTOS;
  const capped = photos.slice(0, MAX_PHOTOS);
  const photoBudget = Math.max(budgetBytes - baseBytes, 1024 * 1024); // At least 1MB for photos

  let current = capped.map(p => ({ ...p, _originalBytes: estimateDataUrlBytes(p.dataUrl || p) }));
  let totalBytes = current.reduce((s, p) => s + p._originalBytes, 0);

  if (totalBytes <= photoBudget) {
    return { photos: current.map(p => ({ ...p, dataUrl: p.dataUrl || p })), totalBytes, compressed: 0, truncated };
  }

  const perPhotoBudget = Math.floor(photoBudget / current.length);
  let compressedCount = 0;

  for (let i = 0; i < current.length; i++) {
    const photo = current[i];
    const raw = photo.dataUrl || photo;
    if (estimateDataUrlBytes(raw) <= perPhotoBudget) continue;

    let best = raw;
    for (const quality of [0.65, 0.5, 0.4, MIN_QUALITY]) {
      for (const maxDim of [1024, 800, 640]) {
        try {
          const compressed = await compressImage(raw, { maxWidth: maxDim, maxHeight: maxDim, quality });
          if (estimateDataUrlBytes(compressed) <= perPhotoBudget) {
            best = compressed;
            break;
          }
        } catch {}
      }
      if (best !== raw) break;
    }

    if (best !== raw) {
      current[i] = { ...photo, dataUrl: best, _originalBytes: photo._originalBytes };
      compressedCount++;
    }
  }

  totalBytes = current.reduce((s, p) => s + estimateDataUrlBytes(p.dataUrl), 0);
  if (totalBytes > photoBudget) {
    for (let i = 0; i < current.length; i++) {
      try {
        const aggressive = await compressImage(current[i].dataUrl, { maxWidth: 480, maxHeight: 480, quality: MIN_QUALITY });
        current[i] = { ...current[i], dataUrl: aggressive };
      } catch {}
    }
    totalBytes = current.reduce((s, p) => s + estimateDataUrlBytes(p.dataUrl), 0);
    compressedCount = current.length;
  }

  return {
    photos: current.map(p => ({ dataUrl: p.dataUrl, name: p.name, index: p.index })),
    totalBytes,
    compressed: compressedCount,
    truncated,
  };
}
