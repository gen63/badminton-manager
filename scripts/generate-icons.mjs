import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '../public');

// SVGを読み込み
const svgBuffer = readFileSync(join(publicDir, 'favicon.svg'));

// アイコンサイズ
const sizes = [192, 512];

// Apple Touch Icon用
const appleSize = 180;

async function generateIcons() {
  console.log('🎨 PWAアイコンを生成中...');

  // PWAアイコン生成
  for (const size of sizes) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(join(publicDir, `pwa-${size}x${size}.png`));
    console.log(`  ✓ pwa-${size}x${size}.png`);
  }

  // Apple Touch Icon生成
  await sharp(svgBuffer)
    .resize(appleSize, appleSize)
    .png()
    .toFile(join(publicDir, 'apple-touch-icon.png'));
  console.log(`  ✓ apple-touch-icon.png`);

  console.log('✅ アイコン生成完了!');
}

generateIcons().catch(console.error);
