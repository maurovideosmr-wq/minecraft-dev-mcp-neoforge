import { describe, expect, it } from 'vitest';
import { parseForgeModToml } from '../src/utils/forge-toml-blocks.js';

const mdkLikeToml = `
modLoader="javafml"
loaderVersion="[4,)"

[[mods]] #mandatory
modId="examplemod"
version="1.0.0"
displayName="Example"
description="x"
authors="a, b"
license="MIT"

[[mixins]]
config="examplemod.mixins.json"

[[accessTransformers]]
file="META-INF/accesstransformer.cfg"

[[dependencies.examplemod]]
modId="neoforge"
type="required"
versionRange="[21.1,)"
ordering="NONE"
side="BOTH"

[[dependencies.examplemod]]
modId="minecraft"
type="required"
versionRange="[1.21.1,1.22)"
ordering="NONE"
side="BOTH"

[[dependencies.examplemod]]
modId="jei"
type="optional"
versionRange="[15,)"
side="CLIENT"
`;

describe('parseForgeModToml', () => {
  it('parses [[mods]] with trailing comment on header line', () => {
    const r = parseForgeModToml('[[mods]] #mandatory\nmodId="a"\nversion="1"\n');
    expect(r.primaryMod?.modId).toBe('a');
    expect(r.primaryMod?.version).toBe('1');
  });

  it('parses mixins, access transformers, and dependency types', () => {
    const r = parseForgeModToml(mdkLikeToml);
    expect(r.primaryMod?.modId).toBe('examplemod');
    expect(r.mixinConfigs).toContain('examplemod.mixins.json');
    expect(r.accessTransformerFiles).toContain('META-INF/accesstransformer.cfg');

    const neo = r.dependencies.find((d) => d.modId === 'neoforge');
    expect(neo?.dependencyKind).toBe('required');

    const mc = r.dependencies.find((d) => d.modId === 'minecraft');
    expect(mc?.dependencyKind).toBe('required');
    expect(mc?.versionRange).toContain('1.21.1');

    const jei = r.dependencies.find((d) => d.modId === 'jei');
    expect(jei?.dependencyKind).toBe('optional');
    expect(jei?.side).toBe('CLIENT');
  });

  it('parses incompatible dependency', () => {
    const r = parseForgeModToml(`
[[dependencies.x]]
modId="badmod"
type="incompatible"
versionRange="*"
`);
    expect(r.dependencies[0]?.dependencyKind).toBe('incompatible');
  });
});
