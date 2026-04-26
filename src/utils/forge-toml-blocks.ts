/**
 * Minimal TOML array-table block splitter for Forge / NeoForge mods.toml & neoforge.mods.toml.
 * Does not aim for full TOML; handles common MDK patterns.
 */

/** NeoForge / Forge `[[dependencies.*]]` `type=` values (case-insensitive). */
export type ForgeTomlDependencyKind = 'required' | 'optional' | 'incompatible' | 'discouraged';

export type ForgeTomlDependency = {
  modId: string;
  versionRange: string;
  dependencyKind: ForgeTomlDependencyKind;
  side?: 'CLIENT' | 'SERVER' | 'BOTH';
  ordering?: string;
};

export type ForgeTomlModsFields = {
  modId?: string;
  version?: string;
  displayName?: string;
  description?: string;
  authors?: string;
  license?: string;
};

export type ParsedForgeToml = {
  /** First [[mods]] block wins for canonical id (per project convention). */
  primaryMod?: ForgeTomlModsFields;
  dependencies: ForgeTomlDependency[];
  mixinConfigs: string[];
  accessTransformerFiles: string[];
};

type RawBlock = { header: string; bodyLines: string[] };

function splitArrayTableBlocks(content: string): RawBlock[] {
  const lines = content.split(/\r?\n/);
  const blocks: RawBlock[] = [];
  let current: RawBlock | null = null;

  for (const line of lines) {
    const withoutComment = line.replace(/\s*#.*$/, '').trim();
    const headerMatch = withoutComment.match(/^\[\[([^\]]+)\]\]$/);
    if (headerMatch) {
      if (current) {
        blocks.push(current);
      }
      current = { header: headerMatch[1].trim(), bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  if (current) {
    blocks.push(current);
  }
  return blocks;
}

function parseKeyValueLines(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    } else if (val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Parse neoforge.mods.toml / mods.toml content into structured fields.
 */
export function parseForgeModToml(content: string): ParsedForgeToml {
  const blocks = splitArrayTableBlocks(content);
  const result: ParsedForgeToml = {
    dependencies: [],
    mixinConfigs: [],
    accessTransformerFiles: [],
  };

  for (const block of blocks) {
    const body = block.bodyLines.join('\n');
    const kv = parseKeyValueLines(body);

    if (block.header === 'mods') {
      if (!result.primaryMod) {
        result.primaryMod = {
          modId: kv.modId,
          version: kv.version,
          displayName: kv.displayName,
          description: kv.description,
          authors: kv.authors,
          license: kv.license,
        };
      }
      continue;
    }

    if (block.header.startsWith('dependencies.')) {
      const modId = kv.modId;
      if (!modId) {
        continue;
      }
      const versionRange = kv.versionRange ?? '*';
      const typeRaw = (kv.type ?? 'required').trim().toLowerCase();
      let dependencyKind: ForgeTomlDependencyKind = 'required';
      if (typeRaw === 'optional') {
        dependencyKind = 'optional';
      } else if (typeRaw === 'incompatible') {
        dependencyKind = 'incompatible';
      } else if (typeRaw === 'discouraged') {
        dependencyKind = 'discouraged';
      }
      if (kv.mandatory === 'false') {
        dependencyKind = 'optional';
      }
      const sideRaw = kv.side?.toUpperCase();
      const side =
        sideRaw === 'CLIENT' || sideRaw === 'SERVER' || sideRaw === 'BOTH' ? sideRaw : undefined;
      result.dependencies.push({
        modId,
        versionRange,
        dependencyKind,
        side,
        ordering: kv.ordering,
      });
      continue;
    }

    if (block.header === 'mixins') {
      const cfg = kv.config;
      if (cfg) {
        result.mixinConfigs.push(cfg);
      }
      continue;
    }

    if (block.header === 'accessTransformers') {
      const file = kv.file ?? kv.resource;
      if (file) {
        result.accessTransformerFiles.push(file);
      }
    }
  }

  return result;
}

/**
 * Extract mixin config paths from TOML only (for JAR discovery).
 */
export function extractMixinConfigsFromForgeToml(content: string): string[] {
  return parseForgeModToml(content).mixinConfigs;
}
