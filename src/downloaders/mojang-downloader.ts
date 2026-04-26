import { unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  MOJANG_VERSION_MANIFEST_URL,
  findVersion,
  getClientDownload,
  getClientMappingsDownload,
  getServerDownload,
} from '../parsers/version-manifest.js';
import type { VersionJson, VersionManifest } from '../types/minecraft.js';
import { DownloadError, VersionNotFoundError } from '../utils/errors.js';
import { ensureDir } from '../utils/file-utils.js';
import { computeFileSha1 } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { getMojmapRawPath, getServerJarPath, getVersionJarPath } from '../utils/paths.js';
import { downloadFile, fetchJson } from './http-client.js';

export class MojangDownloader {
  private manifestCache: VersionManifest | null = null;
  private versionJsonCache = new Map<string, Promise<VersionJson>>();

  /**
   * Get version manifest (cached)
   */
  async getVersionManifest(): Promise<VersionManifest> {
    if (this.manifestCache) {
      return this.manifestCache;
    }

    logger.info('Fetching Mojang version manifest');
    this.manifestCache = await fetchJson<VersionManifest>(MOJANG_VERSION_MANIFEST_URL);
    logger.info(`Loaded ${this.manifestCache.versions.length} versions`);

    return this.manifestCache;
  }

  /**
   * Get version JSON for a specific version
   */
  async getVersionJson(version: string): Promise<VersionJson> {
    const cachedVersionJson = this.versionJsonCache.get(version);
    if (cachedVersionJson) {
      return cachedVersionJson;
    }

    const versionJsonPromise = (async () => {
      const manifest = await this.getVersionManifest();
      const versionInfo = findVersion(manifest, version);

      logger.info(`Fetching version JSON for ${version}`);
      return await fetchJson<VersionJson>(versionInfo.url);
    })();

    this.versionJsonCache.set(version, versionJsonPromise);

    try {
      return await versionJsonPromise;
    } catch (error) {
      // Allow retries after transient failures.
      this.versionJsonCache.delete(version);
      throw error;
    }
  }

  /**
   * Download a versioned JAR, verify SHA-1, and on mismatch delete the file,
   * invalidate cached version.json, and retry (handles CDN hiccups / bad partial files).
   */
  private async downloadAndVerifyVersionedAsset(options: {
    version: string;
    destination: string;
    label: string;
    getDownload: (vj: VersionJson) => { url: string; sha1: string };
    onProgress?: (downloaded: number, total: number) => void;
  }): Promise<void> {
    const { version, destination, label, getDownload, onProgress } = options;
    const maxAttempts = 3;
    let lastUrl = '';
    let lastMismatch = '';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        this.versionJsonCache.delete(version);
        try {
          await unlink(destination);
        } catch {
          // missing or already removed
        }
        const waitMs = 1000 * attempt;
        logger.warn(
          `Retrying ${label} for ${version} (attempt ${attempt + 1}/${maxAttempts}) after ${waitMs}ms`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
      }

      const versionJson = await this.getVersionJson(version);
      const download = getDownload(versionJson);
      lastUrl = download.url;

      logger.info(`Downloading Minecraft ${version} ${label}`);
      await downloadFile(download.url, destination, { onProgress });

      logger.info('Verifying file integrity (SHA-1)');
      const actualSha1 = await computeFileSha1(destination);
      if (actualSha1 === download.sha1) {
        return;
      }
      lastMismatch = `expected ${download.sha1}, got ${actualSha1}`;
      logger.warn(`SHA-1 mismatch for ${version} ${label}: ${lastMismatch}`);
    }

    throw new DownloadError(
      lastUrl,
      `SHA-1 mismatch after ${maxAttempts} attempts: ${lastMismatch}`,
    );
  }

  /**
   * Download Minecraft client JAR
   */
  async downloadClientJar(
    version: string,
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<string> {
    const destination = getVersionJarPath(version);
    ensureDir(dirname(destination));

    await this.downloadAndVerifyVersionedAsset({
      version,
      destination,
      label: 'client JAR',
      getDownload: getClientDownload,
      onProgress,
    });

    logger.info(`Client JAR verified: ${destination}`);
    return destination;
  }

  /**
   * Download Minecraft server JAR
   */
  async downloadServerJar(
    version: string,
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<string> {
    const destination = getServerJarPath(version);
    ensureDir(dirname(destination));

    await this.downloadAndVerifyVersionedAsset({
      version,
      destination,
      label: 'server JAR',
      getDownload: getServerDownload,
      onProgress,
    });

    logger.info(`Server JAR verified: ${destination}`);
    return destination;
  }

  /**
   * Download official Mojang mappings (ProGuard format)
   * Note: This downloads the raw ProGuard .txt file, not Tiny format
   * Use MappingService.getMappings('mojmap') to get the converted Tiny file
   */
  async downloadMojangMappings(version: string): Promise<string> {
    const versionJson = await this.getVersionJson(version);
    const mappingsDownload = getClientMappingsDownload(versionJson);

    // Use the raw path since this is ProGuard format, not Tiny
    const destination = getMojmapRawPath(version);
    ensureDir(dirname(destination));

    logger.info(`Downloading Mojang mappings for ${version}`);
    await downloadFile(mappingsDownload.url, destination);

    // Verify SHA-1
    const actualSha1 = await computeFileSha1(destination);
    if (actualSha1 !== mappingsDownload.sha1) {
      throw new DownloadError(
        mappingsDownload.url,
        `SHA-1 mismatch: expected ${mappingsDownload.sha1}, got ${actualSha1}`,
      );
    }

    logger.info(`Mojang mappings (ProGuard format) verified: ${destination}`);
    return destination;
  }

  /**
   * List all available versions
   */
  async listVersions(): Promise<string[]> {
    const manifest = await this.getVersionManifest();
    return manifest.versions.map((v) => v.id);
  }

  /**
   * Check if version exists
   */
  async versionExists(version: string): Promise<boolean> {
    try {
      const manifest = await this.getVersionManifest();
      findVersion(manifest, version);
      return true;
    } catch (error) {
      if (error instanceof VersionNotFoundError) {
        return false;
      }
      throw error;
    }
  }
}

// Singleton instance
let mojangDownloaderInstance: MojangDownloader | undefined;

export function getMojangDownloader(): MojangDownloader {
  if (!mojangDownloaderInstance) {
    mojangDownloaderInstance = new MojangDownloader();
  }
  return mojangDownloaderInstance;
}
