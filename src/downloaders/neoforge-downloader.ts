/**
 * Download NeoForge universal JAR from NeoForged Maven (releases).
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { downloadFile, fetchText } from './http-client.js';
import { logger } from '../utils/logger.js';
import { getNeoforgeJarPath } from '../utils/paths.js';

const MAVEN_RELEASES = 'https://maven.neoforged.net/releases';
const METADATA_URL = `${MAVEN_RELEASES}/net/neoforged/neoforge/maven-metadata.xml`;

function parseVersionsFromMetadata(xml: string): string[] {
  const versions: string[] = [];
  const re = /<version>([^<]+)<\/version>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    versions.push(m[1]);
  }
  return versions;
}

/**
 * Map Minecraft `a.b.c` (e.g. 1.21.1) to modern NeoForge line `b.c` (e.g. 21.1) used in
 * artifact ids like 21.1.228.
 */
export function mcVersionToNeoForgeLine(mcVersion: string): string | null {
  const parts = mcVersion.trim().split('.');
  if (parts.length < 3) {
    return null;
  }
  const [, second, third] = parts;
  if (second === undefined || third === undefined) {
    return null;
  }
  if (!/^\d+$/.test(second) || !/^\d+$/.test(third)) {
    return null;
  }
  return `${second}.${third}`;
}

/** Compare 21.1.228-style ids (and legacy 1.21.1-21.1.10) for sorting. */
function compareNeoForgeArtifactIds(a: string, b: string): number {
  const baseA = a.split('-')[0] ?? a;
  const baseB = b.split('-')[0] ?? b;
  const sa = baseA.split('.');
  const sb = baseB.split('.');
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    const na = parseInt(sa[i] ?? '0', 10);
    const nb = parseInt(sb[i] ?? '0', 10);
    if (na !== nb) {
      return na - nb;
    }
  }
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * Pick latest NeoForge artifact for a Minecraft version:
 * - Legacy: `1.21.1-21.1.xx` (dash form)
 * - Modern: `21.1.N` (NeoForge 21.1 = MC 1.21.1, third segment = build)
 */
export function selectNeoForgeVersionForMc(mcVersion: string, allVersions: string[]): string | null {
  const mc = mcVersion.trim();
  const legacyPrefix = `${mc}-`;
  const legacy = allVersions.filter((v) => v.startsWith(legacyPrefix));
  if (legacy.length > 0) {
    legacy.sort(compareNeoForgeArtifactIds);
    return legacy[legacy.length - 1] ?? null;
  }
  const line = mcVersionToNeoForgeLine(mc);
  if (!line) {
    return null;
  }
  const dot = `${line}.`;
  const modern = allVersions.filter((v) => {
    if (!v.startsWith(dot)) {
      return false;
    }
    const rest = v.slice(dot.length);
    const firstSeg = rest.split('-')[0] ?? '';
    return /^\d+$/.test(firstSeg);
  });
  if (modern.length === 0) {
    return null;
  }
  modern.sort(compareNeoForgeArtifactIds);
  return modern[modern.length - 1] ?? null;
}

export function getNeoForgeUniversalJarUrl(neoForgeVersion: string): string {
  const v = neoForgeVersion.trim();
  return `${MAVEN_RELEASES}/net/neoforged/neoforge/${v}/neoforge-${v}-universal.jar`;
}

export class NeoForgeDownloader {
  private metadataCache: string[] | null = null;

  async fetchAllVersions(): Promise<string[]> {
    if (this.metadataCache) {
      return this.metadataCache;
    }
    const xml = await fetchText(METADATA_URL);
    const versions = parseVersionsFromMetadata(xml);
    this.metadataCache = versions;
    logger.info(`NeoForge Maven: ${versions.length} versions in metadata`);
    return versions;
  }

  /**
   * Resolve NeoForge coordinate: explicit wins; else pick latest for mcVersion.
   */
  async resolveNeoForgeVersion(mcVersion: string, neoForgeVersion?: string): Promise<string> {
    if (neoForgeVersion?.trim()) {
      return neoForgeVersion.trim();
    }
    const all = await this.fetchAllVersions();
    const picked = selectNeoForgeVersionForMc(mcVersion.trim(), all);
    if (!picked) {
      throw new Error(
        `No NeoForge version found for Minecraft ${mcVersion}. Specify neoForgeVersion explicitly (e.g. from your MDK gradle).`,
      );
    }
    logger.info(`Resolved NeoForge ${picked} for MC ${mcVersion}`);
    return picked;
  }

  /**
   * Download universal JAR if missing; return local path.
   */
  async ensureUniversalJar(
    mcVersion: string,
    neoForgeVersion?: string,
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<{ jarPath: string; neoForgeVersion: string }> {
    const resolved = await this.resolveNeoForgeVersion(mcVersion, neoForgeVersion);
    const jarPath = getNeoforgeJarPath(resolved);

    if (existsSync(jarPath)) {
      return { jarPath, neoForgeVersion: resolved };
    }

    const url = getNeoForgeUniversalJarUrl(resolved);
    mkdirSync(dirname(jarPath), { recursive: true });
    await downloadFile(url, jarPath, { onProgress });
    return { jarPath, neoForgeVersion: resolved };
  }
}

let neoForgeDownloader: NeoForgeDownloader | undefined;

export function getNeoForgeDownloader(): NeoForgeDownloader {
  if (!neoForgeDownloader) {
    neoForgeDownloader = new NeoForgeDownloader();
  }
  return neoForgeDownloader;
}
