/**
 * Re-download a Minecraft server JAR with Mojang SHA-1 verification.
 * Usage: npx tsx scripts/redownload-minecraft-server.ts [version]
 * Example: npx tsx scripts/redownload-minecraft-server.ts 1.21.11
 */
import { unlinkSync } from 'node:fs';
import { MojangDownloader } from '../src/downloaders/mojang-downloader.js';
import { getServerJarPath } from '../src/utils/paths.js';

const version = process.argv[2] ?? '1.21.11';
const path = getServerJarPath(version);
try {
  unlinkSync(path);
  console.warn(`Removed existing file: ${path}`);
} catch {
  // missing
}

const downloader = new MojangDownloader();
const jarPath = await downloader.downloadServerJar(version, (downloaded, total) => {
  process.stdout.write(`\rDownload: ${((downloaded / total) * 100).toFixed(1)}%`);
});
console.log(`\nOK: ${jarPath}`);
