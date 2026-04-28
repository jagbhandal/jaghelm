/**
 * Logo + background upload route.
 *
 *   POST /api/upload?type=logo|bg  → multipart form, single file field
 *
 * Accepts the file types defined in upload.js (PNG/JPEG/GIF/WebP/SVG).
 * On success returns the public URL the client can use to reference it.
 */

import { Router } from 'express';

import { apiError } from '../errors.js';

const router = Router();

/**
 * Build the upload route. The multer instance is created at the server
 * entry point because it depends on the resolved uploads directory.
 */
export function createUploadRoutes(upload) {
  router.post('/', (req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) return apiError(res, 400, err.message);
      if (!req.file) return apiError(res, 400, 'No file');
      res.json({ url: `/uploads/${req.file.filename}`, filename: req.file.filename });
    });
  });
  return router;
}
