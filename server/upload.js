/**
 * Logo + background upload pipeline (multer).
 *
 * Files land in <project>/uploads/ with a fixed filename: `logo.<ext>` or
 * `bg.<ext>` based on the `?type=` query string. MIME type is checked against
 * the allowlist before the file is written. Filename extension comes from
 * the client-provided originalname — see KNOWN-ISSUES for the planned
 * tightening of this.
 *
 * Size cap: 5 MB per file.
 */

import multer from 'multer';
import { extname } from 'path';

export const ALLOWED_UPLOAD_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

/** Build the multer middleware instance. Call once, mount on the upload route. */
export function createUploadMiddleware(uploadsDir) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const prefix = req.query.type === 'logo' ? 'logo' : 'bg';
      const ext = extname(file.originalname) || '.png';
      cb(null, `${prefix}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: MAX_SIZE_BYTES },
    fileFilter: (req, file, cb) => {
      if (ALLOWED_UPLOAD_TYPES.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`File type not allowed: ${file.mimetype}. Accepted: PNG, JPEG, GIF, WebP, SVG`));
      }
    },
  });
}
