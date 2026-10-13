import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ZIP_UPLOAD_LIMIT, sourceHeaders, sourceWorkerUrl, removeZipSource } from '../services/sourceUploads';

const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ZIP_UPLOAD_LIMIT, files: 1, fields: 0, parts: 2 },
  fileFilter: (_req, file, done) => done(/\.zip$/i.test(file.originalname) ? null : new Error('Choose a .zip website archive'), /\.zip$/i.test(file.originalname)),
}).single('file');

export function zipWebsiteUpload(req: Request, res: Response, next: NextFunction) {
  upload(req, res, error => {
    if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
      .json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'ZIP exceeds the 100 MB upload limit' : error.message });
    next();
  });
}

export async function uploadSiteZip(req: Request, res: Response, next: NextFunction) {
  const file = (req as any).file;
  if (!file) return res.status(400).json({ error: 'Choose a ZIP file to upload' });
  if (!process.env.PREVIEW_API_SECRET) return res.status(503).json({ error: 'The source upload service is not configured' });
  const ownerId = (req as any).account.id;
  let uploaded: any;
  try {
    const response = await axios.post(sourceWorkerUrl() + '/api/sources/zip', file.buffer, {
      params: { filename: file.originalname }, headers: { ...sourceHeaders(ownerId), 'Content-Type': 'application/zip' },
      maxBodyLength: ZIP_UPLOAD_LIMIT, timeout: 120000,
    });
    uploaded = response.data;
    const name = uploaded.filename.replace(/\.zip$/i, '') || 'Static website';
    const site = await prisma.site.create({ data: {
      ownerId, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + randomUUID(),
      sourceType: 'ZIP', sourceUrl: uploaded.filename, status: 'NEW', settings: { sourceUpload: uploaded },
    } });
    res.status(201).json({ site });
  } catch (error: any) {
    if (uploaded) await removeZipSource({ sourceType: 'ZIP', ownerId, settings: { sourceUpload: uploaded } }).catch(() => undefined);
    if (axios.isAxiosError(error)) return res.status(error.response?.status || 503)
      .json({ error: error.response?.data?.detail || 'The ZIP upload could not reach the worker. Please try again.' });
    next(error);
  }
}
