import { describe, expect, it } from 'vitest';
import {
  getNeoForgeUniversalJarUrl,
  mcVersionToNeoForgeLine,
  selectNeoForgeVersionForMc,
} from '../src/downloaders/neoforge-downloader.js';

describe('NeoForgeDownloader helpers', () => {
  it('mcVersionToNeoForgeLine maps 1.21.1 to 21.1', () => {
    expect(mcVersionToNeoForgeLine('1.21.1')).toBe('21.1');
    expect(mcVersionToNeoForgeLine('1.20.4')).toBe('20.4');
  });

  it('selectNeoForgeVersionForMc picks latest matching legacy MC prefix', () => {
    const all = [
      '1.20.1-20.1.0',
      '1.21.1-21.1.0',
      '1.21.1-21.1.2',
      '1.21.1-21.1.10',
      '1.21.4-21.4.0',
    ];
    expect(selectNeoForgeVersionForMc('1.21.1', all)).toBe('1.21.1-21.1.10');
    expect(selectNeoForgeVersionForMc('1.20.1', all)).toBe('1.20.1-20.1.0');
  });

  it('selectNeoForgeVersionForMc prefers legacy dash form over modern when both exist', () => {
    const all = ['1.21.1-21.1.2', '21.1.200'];
    expect(selectNeoForgeVersionForMc('1.21.1', all)).toBe('1.21.1-21.1.2');
  });

  it('selectNeoForgeVersionForMc picks max modern 21.1.N for MC 1.21.1', () => {
    const all = ['21.1.9', '21.1.100', '21.1.10', '21.4.1', '20.1.0'];
    expect(selectNeoForgeVersionForMc('1.21.1', all)).toBe('21.1.100');
  });

  it('selectNeoForgeVersionForMc returns null when no match', () => {
    expect(selectNeoForgeVersionForMc('1.99.0', ['1.21.1-21.1.0'])).toBeNull();
    expect(selectNeoForgeVersionForMc('1.99.0', ['21.1.0'])).toBeNull();
  });

  it('getNeoForgeUniversalJarUrl uses releases layout (modern id)', () => {
    const v = '21.1.228';
    expect(getNeoForgeUniversalJarUrl(v)).toBe(
      'https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.228/neoforge-21.1.228-universal.jar',
    );
  });

  it('trims mc version and neo version inputs', () => {
    expect(selectNeoForgeVersionForMc(' 1.21.1 ', ['1.21.1-21.1.0'])).toBe('1.21.1-21.1.0');
    const url = getNeoForgeUniversalJarUrl(' 21.1.0 ');
    expect(url).toContain('21.1.0');
    expect(url).not.toContain(' ');
  });
});
