import axios from 'axios';

export const ZIP_UPLOAD_LIMIT = 100 * 1024 * 1024;
export const sourceWorkerUrl = () => process.env.WORKER_URL || process.env.WORKER_API_URL || 'http://localhost:8000';
export const sourceHeaders = (owner: string) => ({ 'X-Preview-Secret': process.env.PREVIEW_API_SECRET, 'X-Source-Owner': owner });
export function zipSource(site: any): { id: string; filename: string } | undefined {
  if (site?.sourceType !== 'ZIP') return undefined;
  const source = site.settings?.sourceUpload;
  if (!source?.id || !source?.filename) throw Object.assign(new Error('Uploaded ZIP is unavailable. Upload it again.'), { statusCode: 409 });
  return source;
}
export async function removeZipSource(site: any) {
  if (site?.sourceType !== 'ZIP' || !site.settings?.sourceUpload?.id) return;
  await axios.delete(sourceWorkerUrl() + '/api/sources/zip/' + site.settings.sourceUpload.id,
    { headers: sourceHeaders(site.ownerId), timeout: 10000 });
}
