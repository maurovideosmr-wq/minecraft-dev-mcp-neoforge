import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyJavaVersion } from '../../src/java/java-process.js';
import { getRegistryService } from '../../src/services/registry-service.js';
import { paths } from '../../src/utils/paths.js';
import { TEST_VERSION } from '../test-constants.js';

/**
 * Skip registry tests only when a server JAR **exists** but is unusable (truncated / corrupt ZIP).
 * If the file is **missing**, do not skip — tests will download a fresh JAR.
 */
function shouldSkipRegistryDueToCorruptCache(jarPath: string): boolean {
  if (!existsSync(jarPath)) {
    return false;
  }
  try {
    if (statSync(jarPath).size < 512 * 1024) {
      return true;
    }
    const zip = new AdmZip(jarPath);
    return zip.getEntries().length < 50;
  } catch {
    return true;
  }
}

const SERVER_JAR_PATH = join(paths.jars(), `minecraft_server.${TEST_VERSION}.jar`);

/**
 * Registry Data Extraction Tests
 *
 * Tests the registry service's ability to:
 * - Extract registry data from Minecraft server JAR
 * - Parse blocks, items, and other game registries
 * - Handle version-specific registry formats
 *
 * Skipped when a **cached** server JAR is present but not a valid ZIP (e.g. interrupted download).
 * Delete the bad file under AppData .../minecraft-dev-mcp/jars/ to force re-download.
 */
describe.skipIf(shouldSkipRegistryDueToCorruptCache(SERVER_JAR_PATH))(
  'Registry Data Extraction',
  () => {
    beforeAll(async () => {
      // Verify Java is available (required for registry extraction)
      await verifyJavaVersion(17);
    }, 30000);

    it('should extract registry data from Minecraft', async () => {
      const registryService = getRegistryService();

      const data = await registryService.getRegistryData(TEST_VERSION);

      expect(data).toBeDefined();
      expect(typeof data).toBe('object');
    }, 600000); // cold download + data gen (align with vitest.config testTimeout)

    it('should contain blocks registry', async () => {
      const registryService = getRegistryService();

      const data = await registryService.getRegistryData(TEST_VERSION, 'block');

      expect(data).toBeDefined();

      // Should have common blocks
      const dataStr = JSON.stringify(data);
      expect(dataStr).toContain('stone');
      expect(dataStr).toContain('dirt');
    }, 600000);

    it('should contain items registry', async () => {
      const registryService = getRegistryService();

      const data = await registryService.getRegistryData(TEST_VERSION, 'item');

      expect(data).toBeDefined();

      // Should have common items
      const dataStr = JSON.stringify(data);
      expect(dataStr).toContain('diamond');
      expect(dataStr).toContain('stick');
    }, 600000);
  },
);
