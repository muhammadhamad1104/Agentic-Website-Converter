const path = require('node:path');
const sharp = require('sharp');
const directory = path.resolve(__dirname, '../../frontend/public/brand');

(async () => {
  for (const [filename, size] of [['favicon-48.png', 48], ['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
    await sharp(path.join(directory, 'favicon.svg')).resize(size, size).png().toFile(path.join(directory, filename));
  }
  console.log('Brand icons generated.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
