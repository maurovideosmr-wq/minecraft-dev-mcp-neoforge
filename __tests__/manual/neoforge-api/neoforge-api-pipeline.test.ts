import { beforeAll, describe, expect, it } from 'vitest';
import { verifyJavaVersion } from '../../../src/java/java-process.js';
import { handleIndexNeoforgeApi, handleSearchNeoforgeApi } from '../../../src/server/tools.js';
import { getSearchIndexService } from '../../../src/services/search-index-service.js';
import {
  NEOFORGE_E2E_ARTIFACT_VERSION,
  NEOFORGE_E2E_MC,
} from '../../test-constants.js';

/**
 * Full NeoForge API pipeline: Maven download → decompile (Vineflower) → FTS index → search.
 * Network + Java + large download. Opt-in only.
 *
 * Run: `npm run test:manual:neoforge`
 * Defaults: MC `1.21.1` + NeoForge artifact `21.1.228` (see `__tests__/test-constants.ts`).
 * Override: `MCP_NEOFORGE_MC`, `MCP_NEOFORGE_VERSION` (full Maven version id).
 */

const MC = (process.env.MCP_NEOFORGE_MC || NEOFORGE_E2E_MC).trim();
const NEO_FORGE = (process.env.MCP_NEOFORGE_VERSION || NEOFORGE_E2E_ARTIFACT_VERSION).trim();

describe.runIf(process.env.MCP_NEOFORGE_E2E === '1')(`NeoForge API pipeline (MC ${MC}, NeoForge ${NEO_FORGE})`, () => {
  beforeAll(async () => {
    await verifyJavaVersion(17);
  }, 60000);

  it('index_neoforge_api then search_neoforge_api returns hits', async () => {
    const indexRes = await handleIndexNeoforgeApi({
      mcVersion: MC,
      neoForgeVersion: NEO_FORGE,
      force: false,
    });
    expect(indexRes.isError).toBeUndefined();
    const idxText = (indexRes as { content: { text: string }[] }).content[0]?.text;
    expect(idxText).toBeDefined();
    const idx = JSON.parse(idxText as string);
    expect(idx.filesIndexed).toBeGreaterThan(0);
    expect(idx.neoForgeVersion).toBeDefined();

    const searchSvc = getSearchIndexService();
    const neoV = searchSvc.getLatestIndexedNeoForgeVersion(MC);
    expect(neoV).toBeDefined();

    const searchRes = await handleSearchNeoforgeApi({ query: 'NeoForge', mcVersion: MC });
    expect(searchRes.isError).toBeUndefined();
    const srText = (searchRes as { content: { text: string }[] }).content[0]?.text;
    expect(srText).toBeDefined();
    const sr = JSON.parse(srText as string);
    expect(sr.count).toBeGreaterThan(0);
  }, 600000);
});
