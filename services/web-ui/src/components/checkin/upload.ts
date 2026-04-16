/**
 * Browser upload helper for atomic multi-file check-in.
 *
 * One-part PUT with progress tracking via XMLHttpRequest (fetch doesn't
 * expose upload progress). Presigned URLs from VAST get rewritten through
 * the nginx /s3-proxy/ path so same-origin rules don't block cross-bucket
 * uploads.
 */
import { proxyS3Url } from "../../api";

export interface PartUploadProgress {
  fileIndex: number;
  partNumber: number;
  loaded: number;
  total: number;
  pct: number;
}

export interface PartUploadResult {
  partNumber: number;
  eTag: string;
}

/**
 * PUT a File slice to a presigned URL and return its ETag.
 * Throws on any HTTP error; caller decides how to compensate.
 */
export function putPart(
  presignedUrl: string,
  body: Blob,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const target = proxyS3Url(presignedUrl) ?? presignedUrl;
    xhr.open("PUT", target);

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // Browsers hide most headers cross-origin; our nginx /s3-proxy/ adds
        // Access-Control-Expose-Headers: ETag so we can read it. Strip the
        // surrounding quotes S3 returns.
        const etag = xhr.getResponseHeader("ETag")?.replace(/^"|"$/g, "") ?? "";
        if (!etag) {
          reject(new Error("S3 returned no ETag header (check CORS Access-Control-Expose-Headers)"));
          return;
        }
        resolve(etag);
      } else {
        reject(new Error(`Upload failed: HTTP ${xhr.status} — ${xhr.responseText.slice(0, 200)}`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed: network error"));
    xhr.onabort = () => reject(new Error("Upload aborted"));

    if (signal) {
      signal.addEventListener("abort", () => xhr.abort());
    }

    xhr.send(body);
  });
}

/**
 * Slice a File into Blobs matching the reservation's part plan.
 * Uses the presigned URL `sizeBytes` (not the raw file length) because
 * the reservation is authoritative — server-side part sizing may have
 * bumped up from the client's preferred value.
 */
export function sliceFile(
  file: File,
  parts: Array<{ partNumber: number; sizeBytes: number }>,
): Array<{ partNumber: number; blob: Blob }> {
  const slices: Array<{ partNumber: number; blob: Blob }> = [];
  let offset = 0;
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  for (const part of sorted) {
    const end = Math.min(offset + part.sizeBytes, file.size);
    slices.push({ partNumber: part.partNumber, blob: file.slice(offset, end) });
    offset = end;
  }
  return slices;
}
