import sharp from 'sharp';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_FORMAT_ERROR = 'Choose a valid JPG, PNG, WebP or GIF photo.';

export async function profilePhoto(buffer: Buffer): Promise<string> {
  if (!buffer.length || buffer.length > MAX_PHOTO_BYTES) throw new Error(PHOTO_FORMAT_ERROR);
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const gif = ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  const webp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!png && !jpeg && !gif && !webp) throw new Error(PHOTO_FORMAT_ERROR);
  // Decode and re-encode instead of retaining user-supplied metadata or file content.
  const image = sharp(buffer, { limitInputPixels: 24_000_000, failOn: 'warning', animated: false });
  const metadata = await image.metadata();
  if (!['jpeg', 'png', 'webp', 'gif'].includes(metadata.format || '')) throw new Error(PHOTO_FORMAT_ERROR);
  const photo = await image.rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
  return 'data:image/webp;base64,' + photo.toString('base64');
}
