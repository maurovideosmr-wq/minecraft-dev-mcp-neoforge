import { beforeEach, describe, expect, it, vi } from 'vitest';

const neoMocks = vi.hoisted(() => ({
  decompileApi: vi.fn(),
  resolveNeoForgeVersion: vi.fn(),
  indexNeoforgeApi: vi.fn(),
  searchNeoforgeApi: vi.fn(),
  getLatestIndexedNeoForgeVersion: vi.fn(),
}));

vi.mock('../src/services/neoforge-decompile-service.js', () => ({
  getNeoForgeDecompileService: () => ({
    decompileApi: neoMocks.decompileApi,
  }),
}));

vi.mock('../src/downloaders/neoforge-downloader.js', () => ({
  getNeoForgeDownloader: () => ({
    resolveNeoForgeVersion: neoMocks.resolveNeoForgeVersion,
  }),
}));

vi.mock('../src/services/search-index-service.js', () => ({
  getSearchIndexService: () => ({
    indexNeoforgeApi: neoMocks.indexNeoforgeApi,
    searchNeoforgeApi: neoMocks.searchNeoforgeApi,
    getLatestIndexedNeoForgeVersion: neoMocks.getLatestIndexedNeoForgeVersion,
  }),
}));

import {
  handleDecompileNeoforgeApi,
  handleIndexNeoforgeApi,
  handleSearchNeoforgeApi,
} from '../src/server/tools.js';

describe('NeoForge API MCP handlers (mocked services)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleDecompileNeoforgeApi returns JSON with outputDir from decompileApi', async () => {
    neoMocks.decompileApi.mockResolvedValue({
      outputDir: '/tmp/neoforge-out',
      neoForgeVersion: '1.21.1-21.1.0-mock',
      jarPath: '/tmp/neoforge.jar',
    });

    const r = await handleDecompileNeoforgeApi({ mcVersion: '1.21.1' });
    expect(r.isError).toBeUndefined();
    const j = JSON.parse((r as { content: { text: string }[] }).content[0]!.text);
    expect(j.outputDir).toBe('/tmp/neoforge-out');
    expect(j.neoForgeVersion).toBe('1.21.1-21.1.0-mock');
    expect(neoMocks.decompileApi).toHaveBeenCalledWith('1.21.1', undefined, { force: undefined });
  });

  it('handleIndexNeoforgeApi resolves version, decompiles, and indexes', async () => {
    neoMocks.resolveNeoForgeVersion.mockResolvedValue('1.21.1-resolved');
    neoMocks.decompileApi.mockResolvedValue({
      outputDir: '/o',
      neoForgeVersion: '1.21.1-resolved',
      jarPath: '/j',
    });
    neoMocks.indexNeoforgeApi.mockResolvedValue({ fileCount: 4, duration: 12 });

    const r = await handleIndexNeoforgeApi({ mcVersion: '1.21.1' });
    expect(r.isError).toBeUndefined();
    const j = JSON.parse((r as { content: { text: string }[] }).content[0]!.text);
    expect(j.neoForgeVersion).toBe('1.21.1-resolved');
    expect(j.filesIndexed).toBe(4);
    expect(neoMocks.resolveNeoForgeVersion).toHaveBeenCalledWith('1.21.1', undefined);
    expect(neoMocks.indexNeoforgeApi).toHaveBeenCalledWith('1.21.1', '1.21.1-resolved');
  });

  it('handleSearchNeoforgeApi returns isError when no index for MC version', async () => {
    neoMocks.getLatestIndexedNeoForgeVersion.mockReturnValue(undefined);
    const r = await handleSearchNeoforgeApi({ query: 'Foo', mcVersion: '9.9.9-noindex' });
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect((r as { content: { text: string }[] }).content[0]!.text).toContain('index_neoforge_api');
  });

  it('handleSearchNeoforgeApi uses latest neo version and returns search results', async () => {
    neoMocks.getLatestIndexedNeoForgeVersion.mockReturnValue('1.21.1-indexed');
    neoMocks.searchNeoforgeApi.mockReturnValue([
      {
        entryType: 'class',
        className: 'com.example.Demo',
        filePath: 'com/example/Demo.java',
        line: 1,
        symbol: 'Demo',
        context: '',
        version: '1.21.1',
        mapping: '1.21.1-indexed',
        score: 0.5,
      },
    ]);

    const r = await handleSearchNeoforgeApi({ query: 'Demo', mcVersion: '1.21.1' });
    expect(r.isError).toBeUndefined();
    const j = JSON.parse((r as { content: { text: string }[] }).content[0]!.text);
    expect(j.count).toBe(1);
    expect(j.neoForgeVersion).toBe('1.21.1-indexed');
    expect(neoMocks.searchNeoforgeApi).toHaveBeenCalled();
  });
});
