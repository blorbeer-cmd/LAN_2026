// Client-side image resize/compress, shared by anything that lets someone
// upload a small picture (player avatars, game icons) — keeps the DB (a
// single SQLite file synced/backed up as a whole) from ballooning with
// full-resolution phone photos when a small square thumbnail is all that's
// actually displayed.

export function resizeImageFile(file, maxSize = 200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Das ist kein gültiges Bild.'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Match screenshots (final scoreboards) stay readable at full-HD size. Larger
// captures and phone photos are scaled down and always re-encoded as JPEG:
// the upload stays small on the LAN, and the browser drops embedded metadata
// such as a phone photo's location along the way.
export const SCREENSHOT_MAX_SIZE = 1920;

export function screenshotScale(width, height, maxSize = SCREENSHOT_MAX_SIZE) {
  const scale = Math.min(1, maxSize / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function screenshotUploadBlob(file, maxSize = SCREENSHOT_MAX_SIZE, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Das ist kein Bild, das der Browser öffnen kann.'));
    };
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = screenshotScale(img.naturalWidth, img.naturalHeight, maxSize);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Das Bild konnte nicht verarbeitet werden.'))), 'image/jpeg', quality);
    };
    img.src = url;
  });
}
