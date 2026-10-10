import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { MAX_PHOTO_BYTES } from '../services/profilePhoto';

// Busboy reaches its parts limit when the first file starts, so allow the final boundary too.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 0, parts: 2 } }).single('photo');
export function profilePhotoUpload(req: Request, res: Response, next: NextFunction) {
  upload(req, res, error => {
    if (!error) return next();
    const oversized = error.code === 'LIMIT_FILE_SIZE';
    res.status(oversized ? 413 : 400).json({ error: oversized ? 'Profile photos must be 5 MB or smaller.' : 'Upload one photo using the photo field.' });
  });
}
