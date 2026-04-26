import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getNeoforgedDocsVersion,
  resolveNeoforgedDocsVersion,
} from '../src/services/documentation-service.js';
import { getAccessTransformerService } from '../src/services/access-transformer-service.js';
import { handleReadResource } from '../src/server/resources.js';
import {
  DecompileModJarSchema,
  handleRemapModJar,
  handleValidateAccessTransformer,
  handleValidateAccessWidener,
  IndexModSchema,
  SearchModCodeSchema,
  SearchModIndexedSchema,
} from '../src/server/tools.js';

describe('NeoForge adapter', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('getNeoforgedDocsVersion uses env NEOFORGE_DOCS_VERSION', () => {
    vi.stubEnv('NEOFORGE_DOCS_VERSION', '1.22.0');
    expect(getNeoforgedDocsVersion()).toBe('1.22.0');
  });

  it('resolveNeoforgedDocsVersion maps mcVersion when env unset', () => {
    expect(resolveNeoforgedDocsVersion('1.21.4')).toBe('1.21.4');
    expect(resolveNeoforgedDocsVersion('1.21')).toBe('1.21.1');
  });

  it('remap_mod_jar rejects modLoader neoforge with isError', async () => {
    const r = await handleRemapModJar({
      inputJar: 'C:/no/jar',
      outputJar: 'C:/out.jar',
      toMapping: 'mojmap',
      modLoader: 'neoforge',
    });
    expect(r.isError).toBe(true);
    const t = r.content[0]!.text;
    expect(t).toContain('neoforge');
  });

  it('validate_access_widener with modLoader neoforge returns skipped guidance', async () => {
    const r = await handleValidateAccessWidener({
      content: 'x',
      mcVersion: '1.21.1',
      modLoader: 'neoforge',
    });
    expect(r.content[0]!.text).toContain('validate_access_transformer');
  });

  it('AT parse: simple public class line', () => {
    const svc = getAccessTransformerService();
    const { lines, errors } = svc.parseFile('public net.minecraft.core.registries.BuiltInRegistries\n');
    expect(errors.length).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.className).toBe('net.minecraft.core.registries.BuiltInRegistries');
  });

  it('resource docs neoforge class URI returns neoforge payload', async () => {
    const r = await handleReadResource('minecraft://docs/neoforge/net.minecraft.entity.Entity');
    const j = JSON.parse(r.contents[0]!.text!);
    expect(j.modLoader).toBe('neoforge');
    expect(j.neoforgedDocsVersion).toBe(getNeoforgedDocsVersion());
    expect(j.relatedDocumentation.length).toBeGreaterThan(0);
    expect(j.relatedDocumentation[0].source).toBe('neoforged_docs');
  });

  it('resource topic neoforge/mixin is NeoForged', async () => {
    const r = await handleReadResource('minecraft://docs/topic/neoforge/mixin');
    const j = JSON.parse(r.contents[0]!.text!);
    expect(j.source).toBe('neoforged_docs');
  });

  it('mod JAR schemas: modLoader neoforge defaults mapping to mojmap when mapping omitted', () => {
    expect(
      DecompileModJarSchema.parse({ jarPath: 'C:/m.jar', modLoader: 'neoforge' }).mapping,
    ).toBe('mojmap');
    expect(
      SearchModCodeSchema.parse({
        modId: 'a',
        modVersion: '1',
        query: 'x',
        searchType: 'class',
        modLoader: 'neoforge',
      }).mapping,
    ).toBe('mojmap');
    expect(IndexModSchema.parse({ modId: 'a', modVersion: '1', modLoader: 'neoforge' }).mapping).toBe(
      'mojmap',
    );
    expect(
      SearchModIndexedSchema.parse({
        query: 'q',
        modId: 'a',
        modVersion: '1',
        modLoader: 'neoforge',
      }).mapping,
    ).toBe('mojmap');
  });

  it('mod JAR schemas: modLoader fabric defaults mapping to yarn when mapping omitted', () => {
    expect(DecompileModJarSchema.parse({ jarPath: 'C:/m.jar' }).mapping).toBe('yarn');
    expect(
      SearchModCodeSchema.parse({
        modId: 'a',
        modVersion: '1',
        query: 'x',
        searchType: 'all',
      }).mapping,
    ).toBe('yarn');
  });

  it('mod JAR schemas: explicit mapping overrides modLoader', () => {
    expect(
      DecompileModJarSchema.parse({ jarPath: 'C:/m.jar', modLoader: 'neoforge', mapping: 'yarn' })
        .mapping,
    ).toBe('yarn');
  });

  it('handleValidateAccessTransformer returns structure for bad content (no decompile)', async () => {
    const r = await handleValidateAccessTransformer({
      content: 'public com.example.fakemod.Thing',
      mcVersion: '1.0.0',
    });
    const j = JSON.parse(r.content[0]!.text!);
    expect(j.kind).toBe('access_transformer');
    expect(j.classValidation.isValid).toBe(false);
  });
});
