import { describe, expect, it } from 'vitest';
import { MojangDownloader } from '../../src/downloaders/mojang-downloader.js';
import { getVersionManager } from '../../src/services/version-manager.js';
import { TEST_VERSION } from '../test-constants.js';

/**
 * Version Management Tests
 *
 * Tests the version manager's ability to:
 * - List available Minecraft versions from Mojang
 * - Verify version existence
 * - Handle invalid versions
 */

describe('Version Management', () => {
  it('should list available Minecraft versions from Mojang', async () => {
    const versionManager = getVersionManager();
    const versions = await versionManager.listAvailableVersions();

    expect(versions).toBeDefined();
    expect(Array.isArray(versions)).toBe(true);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions).toContain(TEST_VERSION);
  }, 30000);

  it('should verify version exists on Mojang servers', async () => {
    const downloader = new MojangDownloader();
    const exists = await downloader.versionExists(TEST_VERSION);

    expect(exists).toBe(true);
  }, 30000);

  it('should return false for non-existent version', async () => {
    const downloader = new MojangDownloader();
    const exists = await downloader.versionExists('999.999.999');

    expect(exists).toBe(false);
  }, 30000);

  describe('Unobfuscated version detection', () => {
    it('should return false for obfuscated versions', async () => {
      const versionManager = getVersionManager();
      // TEST_VERSION (1.21.11) is an obfuscated release — client_mappings present
      const result = await versionManager.isVersionUnobfuscated(TEST_VERSION);
      expect(result).toBe(false);
    }, 30000);

    it('should return true for unobfuscated versions (26.1+)', async () => {
      const versionManager = getVersionManager();
      // 26.1 snapshots ship without obfuscation — no client_mappings in version JSON
      const result = await versionManager.isVersionUnobfuscated('26.1-snapshot-8');
      expect(result).toBe(true);
    }, 30000);
  });
});
