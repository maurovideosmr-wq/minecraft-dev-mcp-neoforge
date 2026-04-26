/**
 * Download and decompile NeoForge universal JAR to Java sources (API reference).
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getNeoForgeDownloader } from '../downloaders/neoforge-downloader.js';
import { getVineflower } from '../java/vineflower.js';
import { logger } from '../utils/logger.js';
import { getDecompiledNeoforgePath } from '../utils/paths.js';

export class NeoForgeDecompileService {
  private downloader = getNeoForgeDownloader();
  private vineflower = getVineflower();

  private hasJavaSources(dir: string): boolean {
    if (!existsSync(dir)) {
      return false;
    }
    const walk = (d: string): boolean => {
      try {
        for (const ent of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, ent.name);
          if (ent.isDirectory()) {
            if (walk(p)) {
              return true;
            }
          } else if (ent.name.endsWith('.java')) {
            return true;
          }
        }
      } catch {
        return false;
      }
      return false;
    };
    return walk(dir);
  }

  /**
   * Ensure universal JAR is present; resolve NeoForge version if omitted.
   */
  async ensureJar(
    mcVersion: string,
    neoForgeVersion?: string,
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<{ jarPath: string; neoForgeVersion: string }> {
    return this.downloader.ensureUniversalJar(mcVersion, neoForgeVersion, onProgress);
  }

  /**
   * Decompile NeoForge API to cache; skip if sources already exist unless force.
   */
  async decompileApi(
    mcVersion: string,
    neoForgeVersion?: string,
    options: { force?: boolean; onProgress?: (c: number, t: number) => void } = {},
  ): Promise<{ outputDir: string; neoForgeVersion: string; jarPath: string }> {
    const { jarPath, neoForgeVersion: resolved } = await this.ensureJar(
      mcVersion,
      neoForgeVersion,
      options.onProgress,
    );
    const outputDir = getDecompiledNeoforgePath(mcVersion, resolved);

    if (!options.force && this.hasJavaSources(outputDir)) {
      logger.info(`NeoForge API sources already present: ${outputDir}`);
      return { outputDir, neoForgeVersion: resolved, jarPath };
    }

    logger.info(`Decompiling NeoForge ${resolved} to ${outputDir}`);

    await this.vineflower.decompile(jarPath, outputDir, {
      decompileGenerics: true,
      hideDefaultConstructor: false,
      asciiStrings: true,
      removeSynthetic: true,
      literalsAsIs: true,
      threads: 4,
      onProgress: options.onProgress,
    });

    return { outputDir, neoForgeVersion: resolved, jarPath };
  }

  getDecompiledPath(mcVersion: string, neoForgeVersion: string): string {
    return getDecompiledNeoforgePath(mcVersion, neoForgeVersion);
  }

  hasDecompiled(mcVersion: string, neoForgeVersion: string): boolean {
    const dir = getDecompiledNeoforgePath(mcVersion, neoForgeVersion);
    return this.hasJavaSources(dir);
  }
}

let instance: NeoForgeDecompileService | undefined;

export function getNeoForgeDecompileService(): NeoForgeDecompileService {
  if (!instance) {
    instance = new NeoForgeDecompileService();
  }
  return instance;
}
