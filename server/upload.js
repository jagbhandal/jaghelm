/**
 * Logo + background upload pipeline (multer).
 *
 * Files land in <project>/uploads/ with a fixed filename: `logo.<ext>` or
 * `bg.<ext>` based on the `?type=` query string. The MIME→extension map
 * below is the single source of truth for both:
 *   - which uploads are accepted (fileFilter),
 *   - what filename extension is written to disk (storage filename callback).
 *
 * Extensions are server-derived from the validated MIME type, NOT from the
 * client-supplied originalname — that string can be anything ("file.exe",
 * "../../etc", etc) and trusting it for the on-disk filename is a known
 * upload pitfall.
 *
 * SVG is deliberately excluded. SVG is XML and can carry <script> tags,
 * inline event handlers, and external references; serving user-supplied
 * SVG back to other users is a stored-XSS vector unless aggressively
 * sanitized (which we don't do). PNG/JPEG/GIF/WebP cover all legitimate
 * logo + background needs.
 *
 * Size cap: 5 MB per file.
 */

import multer from 'multer';

// Allowlist + canonical extension. To allow another type, add an entry here
// only — both the filter and filename derivation read from this map.
const MIME_TO_EXT = {
  'image/png':  '.png',
  'image/jpeg': '.jpg',
  'image/gif':  '.gif',
  'image/webp': '.webp',
};

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

/** True if the MIME type is on the upload allowlist. */
export function isAllowedMime(mime) {
  return Object.prototype.hasOwnProperty.call(MIME_TO_EXT, mime);
}

/** Server-derived extension for an allowed MIME type, or null. */
export function extForMime(mime) {
  return MIME_TO_EXT[mime] || null;
}

/** Filename written to disk, derived from the validated MIME (never the client name). */
export function uploadFilename(type, mime) {
  const prefix = type === 'logo' ? 'logo' : 'bg';
  const ext = extForMime(mime);
  if (!ext) return null;
  return `${prefix}${ext}`;
}

/** Build the multer middleware instance. Call once, mount on the upload route. */
export function createUploadMiddleware(uploadsDir) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      // Extension is server-derived from the MIME type, never from the client.
      // fileFilter has already rejected anything not in the map, so this is
      // guaranteed to hit — the null branch is defensive only.
      const name = uploadFilename(req.query.type, file.mimetype);
      if (!name) {
        return cb(new Error(`Unexpected mimetype in filename callback: ${file.mimetype}`));
      }
      cb(null, name);
    },
  });

  return multer({
    storage,
    limits: { fileSize: MAX_SIZE_BYTES },
    fileFilter: (req, file, cb) => {
      if (isAllowedMime(file.mimetype)) {
        cb(null, true);
      } else {
        const accepted = Object.keys(MIME_TO_EXT)
          .map((m) => m.split('/')[1].toUpperCase())
          .join(', ');
        cb(new Error(`File type not allowed: ${file.mimetype}. Accepted: ${accepted}`));
      }
    },
  });
}