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

/** Build the multer middleware instance. Call once, mount on the upload route. */
export function createUploadMiddleware(uploadsDir) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const prefix = req.query.type === 'logo' ? 'logo' : 'bg';
      // Extension is server-derived from the MIME type, never from the client.
      // fileFilter has already rejected anything not in the map, so this lookup
      // is guaranteed to hit — the fallback is defensive only.
      const ext = MIME_TO_EXT[file.mimetype];
      if (!ext) {
        return cb(new Error(`Unexpected mimetype in filename callback: ${file.mimetype}`));
      }
      cb(null, `${prefix}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: MAX_SIZE_BYTES },
    fileFilter: (req, file, cb) => {
      if (MIME_TO_EXT[file.mimetype]) {
        cb(null, true);
      } else {
        const accepted = Object.keys(MIME_TO_EXT)
          .map(m => m.split('/')[1].toUpperCase())
          .join(', ');
        cb(new Error(`File type not allowed: ${file.mimetype}. Accepted: ${accepted}`));
      }
    },
  });
}