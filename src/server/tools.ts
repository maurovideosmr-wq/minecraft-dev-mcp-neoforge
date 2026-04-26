import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { getCacheManager } from '../cache/cache-manager.js';
import { getNeoForgeDownloader } from '../downloaders/neoforge-downloader.js';
import { getAccessTransformerService } from '../services/access-transformer-service.js';
import { getAccessWidenerService } from '../services/access-widener-service.js';
import { getAstDiffService } from '../services/ast-diff-service.js';
import { getDecompileService } from '../services/decompile-service.js';
import {
  getDocumentationService,
  resolveNeoforgedDocsVersion,
} from '../services/documentation-service.js';
import { getMappingService } from '../services/mapping-service.js';
import { getMixinService } from '../services/mixin-service.js';
import { getModAnalyzerService } from '../services/mod-analyzer-service.js';
import { getModDecompileService } from '../services/mod-decompile-service.js';
import { getNeoForgeDecompileService } from '../services/neoforge-decompile-service.js';
import { getRegistryService } from '../services/registry-service.js';
import { getRemapService } from '../services/remap-service.js';
import { getSearchIndexService } from '../services/search-index-service.js';
import { getVersionManager } from '../services/version-manager.js';
import type { AccessWidener, MappingType, MixinClass } from '../types/minecraft.js';
import { logger } from '../utils/logger.js';
import { normalizePath } from '../utils/path-converter.js';
import { getDecompiledPath } from '../utils/paths.js';

// Tool input schemas
const GetMinecraftSourceSchema = z.object({
  version: z.string().describe('Minecraft version (e.g., "1.21.10")'),
  className: z
    .string()
    .describe('Fully qualified class name (e.g., "net.minecraft.world.entity.Entity")'),
  mapping: z.enum(['yarn', 'mojmap']).describe('Mapping type to use'),
  startLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Starting line number (1-indexed, inclusive). If omitted, starts from line 1.'),
  endLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Ending line number (1-indexed, inclusive). If omitted, returns until end of file.'),
  maxLines: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Maximum number of lines to return. Applied after startLine/endLine filtering. Useful for limiting large responses.',
    ),
});

const DecompileMinecraftVersionSchema = z.object({
  version: z.string().describe('Minecraft version to decompile'),
  mapping: z.enum(['yarn', 'mojmap']).describe('Mapping type to use'),
  force: z.boolean().optional().describe('Force re-decompilation even if cached'),
});

const GetRegistryDataSchema = z.object({
  version: z.string().describe('Minecraft version'),
  registry: z
    .string()
    .optional()
    .describe('Specific registry to fetch (e.g., "blocks", "items", "entities")'),
});

const RemapModJarSchema = z.object({
  inputJar: z.string().describe('Path to the input mod JAR file (supports WSL and Windows paths)'),
  outputJar: z
    .string()
    .describe('Path for the output remapped JAR file (supports WSL and Windows paths)'),
  mcVersion: z
    .string()
    .optional()
    .describe('Minecraft version the mod is for (auto-detected from mod metadata if not provided)'),
  toMapping: z.enum(['yarn', 'mojmap']).describe('Target mapping type'),
  modLoader: z
    .enum(['fabric', 'neoforge'])
    .optional()
    .default('fabric')
    .describe(
      'Pass "neoforge" to get a clear "not supported" message. This tool is for Fabric (intermediary) JARs. Default: fabric',
    ),
});

const FindMappingSchema = z.object({
  symbol: z.string().describe('Symbol name to look up (class name, method name, or field name)'),
  version: z.string().describe('Minecraft version'),
  sourceMapping: z
    .enum(['yarn', 'mojmap', 'intermediary', 'official'])
    .describe('Source mapping type'),
  targetMapping: z
    .enum(['yarn', 'mojmap', 'intermediary', 'official'])
    .describe('Target mapping type'),
});

const SearchMinecraftCodeSchema = z.object({
  version: z.string().describe('Minecraft version'),
  query: z.string().describe('Search query (regex pattern or literal string)'),
  searchType: z.enum(['class', 'method', 'field', 'content', 'all']).describe('Type of search'),
  mapping: z.enum(['yarn', 'mojmap']).describe('Mapping type'),
  limit: z.number().optional().describe('Maximum number of results (default: 50)'),
});

const CompareVersionsSchema = z.object({
  fromVersion: z.string().describe('Source Minecraft version'),
  toVersion: z.string().describe('Target Minecraft version'),
  mapping: z.enum(['yarn', 'mojmap']).describe('Mapping type to use'),
  category: z.enum(['classes', 'registry', 'all']).optional().describe('What to compare'),
});

// Phase 2 Tool Schemas
const AnalyzeMixinSchema = z
  .object({
    source: z
      .string()
      .describe(
        'Mixin source code (Java) or path to a JAR/directory (supports WSL and Windows paths)',
      ),
    mcVersion: z.string().describe('Minecraft version to validate against'),
    mapping: z
      .enum(['yarn', 'mojmap'])
      .optional()
      .describe('Mapping type (default: yarn for fabric, mojmap for neoforge modLoader)'),
    modLoader: z
      .enum(['fabric', 'neoforge'])
      .optional()
      .default('fabric')
      .describe('Default fabric. NeoForge: mapping defaults to mojmap.'),
  })
  .transform((data) => ({
    ...data,
    mapping: data.mapping ?? (data.modLoader === 'neoforge' ? 'mojmap' : 'yarn'),
  }));

const ValidateAccessWidenerSchema = z.object({
  content: z
    .string()
    .describe(
      'Access widener file content or path to .accesswidener file (supports WSL and Windows paths)',
    ),
  mcVersion: z.string().describe('Minecraft version to validate against'),
  mapping: z.enum(['yarn', 'mojmap']).optional().describe('Mapping type (default: yarn)'),
  modLoader: z
    .enum(['fabric', 'neoforge'])
    .optional()
    .default('fabric')
    .describe('Fabric Access Widener only. If "neoforge", returns AT vs AW guidance; use validate_access_transformer for AT'),
});

const ValidateAccessTransformerSchema = z.object({
  content: z
    .string()
    .describe('Access Transformer file content, or path to a .cfg file (WSL/Windows)'),
  mcVersion: z.string().describe('Minecraft version to validate against (need decompiled mojmap sources)'),
  mapping: z
    .enum(['yarn', 'mojmap'])
    .optional()
    .default('mojmap')
    .describe('Use mojmap for NeoForge (default); yarn is supported for parity'),
});

const CompareVersionsDetailedSchema = z.object({
  fromVersion: z.string().describe('Source Minecraft version'),
  toVersion: z.string().describe('Target Minecraft version'),
  mapping: z.enum(['yarn', 'mojmap']).describe('Mapping type to use'),
  packages: z
    .array(z.string())
    .optional()
    .describe('Specific packages to compare (e.g., ["net.minecraft.entity"])'),
  maxClasses: z.number().optional().describe('Maximum classes to compare (default: 1000)'),
});

const IndexVersionSchema = z.object({
  version: z.string().describe('Minecraft version to index'),
  mapping: z.enum(['yarn', 'mojmap']).describe('Mapping type'),
});

const SearchIndexedSchema = z.object({
  query: z.string().describe('Search query (supports FTS5 syntax)'),
  version: z.string().describe('Minecraft version'),
  mapping: z.enum(['yarn', 'mojmap']).describe('Mapping type'),
  types: z
    .array(z.enum(['class', 'method', 'field']))
    .optional()
    .describe('Entry types to search'),
  limit: z.number().optional().describe('Maximum results (default: 100)'),
});

const GetDocumentationSchema = z.object({
  className: z.string().describe('Class name to get documentation for'),
  modLoader: z
    .enum(['fabric', 'neoforge'])
    .optional()
    .default('fabric')
    .describe(
      'Which mod stack the user is on. Use fabric OR neoforge — do not return both. Default fabric.',
    ),
  mcVersion: z
    .string()
    .optional()
    .describe(
      'Minecraft version (e.g. 1.21.1). When modLoader is neoforge, selects NeoForged docs tree unless NEOFORGE_DOCS_VERSION is set.',
    ),
});

const SearchDocumentationSchema = z.object({
  query: z.string().describe('Search query for documentation'),
  modLoader: z
    .enum(['fabric', 'neoforge'])
    .optional()
    .default('fabric')
    .describe('Which mod stack to search. Default fabric.'),
  mcVersion: z
    .string()
    .optional()
    .describe('Minecraft version hint for NeoForged doc URLs when modLoader is neoforge'),
});

// Phase 3 Tool Schemas
const AnalyzeModJarSchema = z.object({
  jarPath: z
    .string()
    .describe('Local file path to the mod JAR file (supports WSL and Windows paths)'),
  includeAllClasses: z
    .boolean()
    .optional()
    .describe('Include all classes in output (can be large, default: false)'),
  includeRawMetadata: z
    .boolean()
    .optional()
    .describe('Include raw metadata files (default: false)'),
});

const DecompileModJarSchema = z
  .object({
    jarPath: z
      .string()
      .describe(
        'Path to the mod JAR file to decompile (can be original or remapped, supports WSL and Windows paths)',
      ),
    mapping: z
      .enum(['yarn', 'mojmap'])
      .optional()
      .describe(
        'Mapping the JAR uses. If omitted, defaults from modLoader: neoforge → mojmap, fabric → yarn. Explicit mapping always wins.',
      ),
    modLoader: z
      .enum(['fabric', 'neoforge'])
      .optional()
      .default('fabric')
      .describe('Stack hint when mapping is omitted. Default fabric.'),
    modId: z.string().optional().describe('Mod ID (auto-detected from JAR if not provided)'),
    modVersion: z
      .string()
      .optional()
      .describe('Mod version (auto-detected from JAR if not provided)'),
  })
  .transform((data) => ({
    ...data,
    mapping: data.mapping ?? (data.modLoader === 'neoforge' ? 'mojmap' : 'yarn'),
  }));

const SearchModCodeSchema = z
  .object({
    modId: z.string().describe('Mod ID (from analyze_mod_jar or decompile_mod_jar)'),
    modVersion: z.string().describe('Mod version'),
    query: z.string().describe('Search query (regex pattern or literal string)'),
    searchType: z
      .enum(['class', 'method', 'field', 'content', 'all'])
      .describe('Type of search: class name, method, field, content, or all'),
    mapping: z
      .enum(['yarn', 'mojmap'])
      .optional()
      .describe('Same as decompile_mod_jar. If omitted, defaults from modLoader (neoforge → mojmap).'),
    modLoader: z
      .enum(['fabric', 'neoforge'])
      .optional()
      .default('fabric')
      .describe('When mapping omitted. Default fabric.'),
    limit: z.number().optional().describe('Maximum number of results (default: 50)'),
  })
  .transform((data) => ({
    ...data,
    mapping: data.mapping ?? (data.modLoader === 'neoforge' ? 'mojmap' : 'yarn'),
  }));

const IndexModSchema = z
  .object({
    modId: z.string().describe('Mod ID (from decompile_mod_jar)'),
    modVersion: z.string().describe('Mod version'),
    mapping: z
      .enum(['yarn', 'mojmap'])
      .optional()
      .describe('Same as decompile. If omitted, defaults from modLoader.'),
    modLoader: z
      .enum(['fabric', 'neoforge'])
      .optional()
      .default('fabric')
      .describe('When mapping omitted. Default fabric.'),
    force: z
      .boolean()
      .optional()
      .describe('Force re-indexing even if already indexed (default: false)'),
  })
  .transform((data) => ({
    ...data,
    mapping: data.mapping ?? (data.modLoader === 'neoforge' ? 'mojmap' : 'yarn'),
  }));

const SearchModIndexedSchema = z
  .object({
    query: z
      .string()
      .describe('Search query (supports FTS5 syntax: AND, OR, NOT, "phrase", prefix*)'),
    modId: z.string().describe('Mod ID'),
    modVersion: z.string().describe('Mod version'),
    mapping: z
      .enum(['yarn', 'mojmap'])
      .optional()
      .describe('Same as index_mod. If omitted, defaults from modLoader.'),
    modLoader: z
      .enum(['fabric', 'neoforge'])
      .optional()
      .default('fabric')
      .describe('When mapping omitted. Default fabric.'),
    types: z
      .array(z.enum(['class', 'method', 'field']))
      .optional()
      .describe('Entry types to search (omit for all types)'),
    limit: z.number().optional().describe('Maximum results (default: 100)'),
  })
  .transform((data) => ({
    ...data,
    mapping: data.mapping ?? (data.modLoader === 'neoforge' ? 'mojmap' : 'yarn'),
  }));

const DecompileNeoforgeApiSchema = z.object({
  mcVersion: z.string().describe('Minecraft version (e.g. 1.21.1)'),
  neoForgeVersion: z
    .string()
    .optional()
    .describe(
      'Full NeoForge Maven version (e.g. 1.21.1-21.1.77). Omit to pick latest for mcVersion from NeoForged Maven metadata.',
    ),
  force: z
    .boolean()
    .optional()
    .describe('Re-run Vineflower even if decompiled sources already exist (default: false)'),
});

const IndexNeoforgeApiSchema = z.object({
  mcVersion: z.string().describe('Minecraft version'),
  neoForgeVersion: z.string().optional().describe('NeoForge Maven version; omit to resolve from Maven'),
  force: z
    .boolean()
    .optional()
    .describe('Force re-decompile and full re-index (default: false)'),
});

const SearchNeoforgeApiSchema = z.object({
  query: z
    .string()
    .describe('FTS5 query (AND, OR, NOT, "phrase", prefix*)'),
  mcVersion: z.string().describe('Minecraft version (must match index)'),
  neoForgeVersion: z
    .string()
    .optional()
    .describe('NeoForge version used when indexing; omit to use latest indexed for this MC version'),
  types: z
    .array(z.enum(['class', 'method', 'field']))
    .optional()
    .describe('Filter by entry types'),
  limit: z.number().optional().describe('Max results (default: 100)'),
});

// Tool definitions
export const tools = [
  {
    name: 'get_minecraft_source',
    description:
      'Get decompiled source code for a specific Minecraft class. This will automatically download, remap, and decompile the Minecraft version if not cached. For NeoForge mod development against vanilla, prefer mapping "mojmap" (Mojang names). Fabric-oriented workflows often use "yarn".',
    inputSchema: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          description: 'Minecraft version (e.g., "1.21.10")',
        },
        className: {
          type: 'string',
          description: 'Fully qualified class name (e.g., "net.minecraft.world.entity.Entity")',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description:
            'Mapping: mojmap matches Mojang/NeoForge dev; yarn matches typical Fabric Loom',
        },
        startLine: {
          type: 'number',
          description:
            'Starting line number (1-indexed, inclusive). If omitted, starts from line 1.',
        },
        endLine: {
          type: 'number',
          description:
            'Ending line number (1-indexed, inclusive). If omitted, returns until end of file.',
        },
        maxLines: {
          type: 'number',
          description:
            'Maximum number of lines to return. Applied after startLine/endLine filtering. Useful for limiting large responses.',
        },
      },
      required: ['version', 'className', 'mapping'],
    },
  },
  {
    name: 'decompile_minecraft_version',
    description:
      'Decompile an entire Minecraft version. This downloads the client JAR, remaps it, and decompiles all classes. Subsequent calls will use cached results. NeoForge users: use mapping "mojmap" to align with Mojang names in MDK; Fabric users often use "yarn".',
    inputSchema: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          description: 'Minecraft version to decompile',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'mojmap for NeoForge-style Mojang names; yarn for Fabric',
        },
        force: {
          type: 'boolean',
          description: 'Force re-decompilation even if cached',
        },
      },
      required: ['version', 'mapping'],
    },
  },
  {
    name: 'list_minecraft_versions',
    description:
      'List available and cached Minecraft versions. Shows which versions are available for download and which are already cached locally.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_registry_data',
    description:
      'Get Minecraft registry data (blocks, items, entities, etc.). This runs the data generator if not cached.',
    inputSchema: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          description: 'Minecraft version',
        },
        registry: {
          type: 'string',
          description:
            'Specific registry to fetch (e.g., "blocks", "items", "entities"). Omit to get all registries.',
        },
      },
      required: ['version'],
    },
  },
  {
    name: 'remap_mod_jar',
    description:
      'Remap a Fabric mod JAR from intermediary to yarn/mojmap (tiny-remapper). NeoForge/MDK builds do not use this path — pass modLoader "neoforge" to return an explicit error and guidance, or use decompile_mod_jar with mojmap for readable mod sources.',
    inputSchema: {
      type: 'object',
      properties: {
        inputJar: {
          type: 'string',
          description: 'Path to the input mod JAR file (WSL or Windows path)',
        },
        outputJar: {
          type: 'string',
          description: 'Path for the output remapped JAR file (WSL or Windows path)',
        },
        mcVersion: {
          type: 'string',
          description:
            'Minecraft version the mod is for (auto-detected from mod metadata if not provided)',
        },
        toMapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Target mapping type',
        },
        modLoader: {
          type: 'string',
          enum: ['fabric', 'neoforge'],
          description: 'Default fabric. If neoforge, the tool will not run remapping and returns a reason.',
        },
      },
      required: ['inputJar', 'outputJar', 'toMapping'],
    },
  },
  {
    name: 'find_mapping',
    description:
      'Look up a symbol (class, method, or field) mapping between different mapping systems. Translates between official (obfuscated), intermediary, yarn, and mojmap names. Use "official" for obfuscated names like "a", "b", "c". For NeoForge-style Mojang names, use mojmap in source/target. Intermediary is Fabric-centric.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Symbol name to look up (class name, method name, or field name)',
        },
        version: {
          type: 'string',
          description: 'Minecraft version',
        },
        sourceMapping: {
          type: 'string',
          enum: ['yarn', 'mojmap', 'intermediary', 'official'],
          description:
            'Source mapping type: official (obfuscated), intermediary (stable IDs), yarn (community names), mojmap (Mojang names)',
        },
        targetMapping: {
          type: 'string',
          enum: ['yarn', 'mojmap', 'intermediary', 'official'],
          description:
            'Target mapping type: official (obfuscated), intermediary (stable IDs), yarn (community names), mojmap (Mojang names)',
        },
      },
      required: ['symbol', 'version', 'sourceMapping', 'targetMapping'],
    },
  },
  {
    name: 'search_minecraft_code',
    description:
      'Search for classes, methods, fields, or content in decompiled Minecraft source code. Supports regex patterns. For NeoForge, prefer decompiling and searching with mapping "mojmap".',
    inputSchema: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          description: 'Minecraft version',
        },
        query: {
          type: 'string',
          description: 'Search query (regex pattern or literal string)',
        },
        searchType: {
          type: 'string',
          enum: ['class', 'method', 'field', 'content', 'all'],
          description: 'Type of search to perform',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'mojmap for NeoForge; yarn for Fabric',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50)',
        },
      },
      required: ['version', 'query', 'searchType', 'mapping'],
    },
  },
  {
    name: 'compare_versions',
    description:
      'Compare two Minecraft versions to find differences in classes or registry data. Useful for tracking breaking changes between versions. NeoForge modders: use "mojmap" to match Mojang-named sources.',
    inputSchema: {
      type: 'object',
      properties: {
        fromVersion: {
          type: 'string',
          description: 'Source Minecraft version',
        },
        toVersion: {
          type: 'string',
          description: 'Target Minecraft version',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Mapping type to use',
        },
        category: {
          type: 'string',
          enum: ['classes', 'registry', 'all'],
          description: 'What to compare (default: all)',
        },
      },
      required: ['fromVersion', 'toVersion', 'mapping'],
    },
  },
  // Phase 2 Tools
  {
    name: 'analyze_mixin',
    description:
      'Analyze and validate Mixin code against Minecraft source. Parses @Mixin annotations, validates injection targets, and suggests fixes for issues. Supports both WSL (/mnt/c/...) and Windows (C:\\...) paths. NeoForge projects: pass mapping "mojmap" to validate against Mojang names.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Mixin source code (Java) or path to a JAR/directory (WSL or Windows path)',
        },
        mcVersion: {
          type: 'string',
          description: 'Minecraft version to validate against',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Optional; defaults to mojmap when modLoader is neoforge, else yarn',
        },
        modLoader: {
          type: 'string',
          enum: ['fabric', 'neoforge'],
          description: 'Default fabric. NeoForge sets default mapping to mojmap',
        },
      },
      required: ['source', 'mcVersion'],
    },
  },
  {
    name: 'validate_access_widener',
    description:
      'Parse and validate **Fabric** Access Widener (.accesswidener v2) only. NeoForge uses Access Transformers — use validate_access_transformer. Set modLoader "neoforge" here to get a short pointer instead of parsing.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            'Access widener file content or path to .accesswidener file (WSL or Windows path)',
        },
        mcVersion: {
          type: 'string',
          description: 'Minecraft version to validate against',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Mapping type (default: yarn). NeoForge: prefer mojmap when validating',
        },
        modLoader: {
          type: 'string',
          enum: ['fabric', 'neoforge'],
          description: 'Default fabric. If neoforge, no AW validation — returns use validate_access_transformer',
        },
      },
      required: ['content', 'mcVersion'],
    },
  },
  {
    name: 'validate_access_transformer',
    description:
      'Parse **NeoForge/Forge** Access Transformer files (not Fabric access widener). Best-effort line parse, then check that target classes exist in decompiled mojmap (or yarn) sources. Use mapping mojmap for NeoForge. Run decompile_minecraft_version first.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'AT file content or file path (WSL/Windows)',
        },
        mcVersion: { type: 'string', description: 'Minecraft version' },
        mapping: { type: 'string', enum: ['yarn', 'mojmap'], description: 'Default mojmap' },
      },
      required: ['content', 'mcVersion'],
    },
  },
  {
    name: 'compare_versions_detailed',
    description:
      'Compare two Minecraft versions with detailed AST-level analysis. Shows method signature changes, field changes, and breaking API changes. NeoForge: use mapping "mojmap".',
    inputSchema: {
      type: 'object',
      properties: {
        fromVersion: {
          type: 'string',
          description: 'Source Minecraft version',
        },
        toVersion: {
          type: 'string',
          description: 'Target Minecraft version',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Mapping type to use',
        },
        packages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific packages to compare (e.g., ["net.minecraft.entity"])',
        },
        maxClasses: {
          type: 'number',
          description: 'Maximum classes to compare (default: 1000)',
        },
      },
      required: ['fromVersion', 'toVersion', 'mapping'],
    },
  },
  {
    name: 'index_minecraft_version',
    description:
      'Create a full-text search index for decompiled Minecraft source. Enables fast searching with search_indexed tool. For NeoForge workflows, build the index with "mojmap" to match MDK decompiled names.',
    inputSchema: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          description: 'Minecraft version to index',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Mapping type',
        },
      },
      required: ['version', 'mapping'],
    },
  },
  {
    name: 'search_indexed',
    description:
      'Fast full-text search using pre-built index. Much faster than search_minecraft_code for large queries. Requires index_minecraft_version first. Use the same mapping you indexed (mojmap for NeoForge, yarn for many Fabric projects).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (supports FTS5 syntax: AND, OR, NOT, "phrase", prefix*)',
        },
        version: {
          type: 'string',
          description: 'Minecraft version',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Mapping type',
        },
        types: {
          type: 'array',
          items: { type: 'string', enum: ['class', 'method', 'field'] },
          description: 'Entry types to search',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 100)',
        },
      },
      required: ['query', 'version', 'mapping'],
    },
  },
  {
    name: 'get_documentation',
    description:
      'Get documentation for a Minecraft class or concept. You MUST set modLoader to match the user project: "fabric" (Fabric Wiki) or "neoforge" (NeoForged 1.21.1 docs). Do not use both in one call — pick one stack.',
    inputSchema: {
      type: 'object',
      properties: {
        className: {
          type: 'string',
          description: 'Class name to get documentation for',
        },
        modLoader: {
          type: 'string',
          enum: ['fabric', 'neoforge'],
          description:
            'Docs: fabric = Fabric Wiki; neoforge = docs.neoforged.net. Doc tree: env NEOFORGE_DOCS_VERSION or mcVersion mapping.',
        },
        mcVersion: {
          type: 'string',
          description: 'Optional MC version for NeoForged docs path when modLoader is neoforge',
        },
      },
      required: ['className'],
    },
  },
  {
    name: 'search_documentation',
    description:
      'Search modding documentation. Set modLoader to "fabric" or "neoforge" to match the user project — one stack per call, not both.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        modLoader: {
          type: 'string',
          enum: ['fabric', 'neoforge'],
          description: 'Default fabric.',
        },
        mcVersion: {
          type: 'string',
          description: 'Optional MC version for NeoForged doc URLs when modLoader is neoforge',
        },
      },
      required: ['query'],
    },
  },
  // Phase 3 Tools
  {
    name: 'analyze_mod_jar',
    description:
      'Analyze a third-party mod JAR file to extract metadata, dependencies, entry points, mixins, and class information. Supports Fabric, Quilt, Forge, and NeoForge mods. Returns comprehensive mod analysis including: mod ID, version, Minecraft compatibility, dependencies, entry points, mixin configurations, and class statistics. Supports both WSL (/mnt/c/...) and Windows (C:\\...) paths.',
    inputSchema: {
      type: 'object',
      properties: {
        jarPath: {
          type: 'string',
          description: 'Local file path to the mod JAR file (WSL or Windows path)',
        },
        includeAllClasses: {
          type: 'boolean',
          description: 'Include full class list in output (can be large). Default: false',
        },
        includeRawMetadata: {
          type: 'boolean',
          description:
            'Include raw metadata files (fabric.mod.json, mixin configs). Default: false',
        },
      },
      required: ['jarPath'],
    },
  },
  {
    name: 'decompile_mod_jar',
    description:
      'Decompile a mod JAR to readable Java. The JAR can be a Fabric (intermediary) build or a remapped JAR from remap_mod_jar, or a NeoForge mod in Mojang names. Mapping: set mapping explicitly, or set modLoader to neoforge (defaults mojmap) or fabric (defaults yarn). Cache: AppData/decompiled-mods/{modId}/{modVersion}/{mapping}/. Auto-detects mod ID and version. WSL/Windows paths.',
    inputSchema: {
      type: 'object',
      properties: {
        jarPath: {
          type: 'string',
          description:
            'Path to the mod JAR file (original or remapped, supports WSL and Windows paths)',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description:
            'Omit to use modLoader defaults (neoforge → mojmap, fabric → yarn). If set, overrides modLoader.',
        },
        modLoader: {
          type: 'string',
          enum: ['fabric', 'neoforge'],
          description: 'When mapping is omitted: fabric (default) → yarn; neoforge → mojmap',
        },
        modId: {
          type: 'string',
          description: 'Mod ID (optional, auto-detected if not provided)',
        },
        modVersion: {
          type: 'string',
          description: 'Mod version (optional, auto-detected if not provided)',
        },
      },
      required: ['jarPath'],
    },
  },
  {
    name: 'search_mod_code',
    description:
      'Search decompiled mod source (after decompile_mod_jar). Use the same mapping as decompile, or modLoader (neoforge → mojmap, fabric → yarn) when mapping omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        modId: {
          type: 'string',
          description: 'Mod ID (from analyze_mod_jar or decompile_mod_jar)',
        },
        modVersion: {
          type: 'string',
          description: 'Mod version',
        },
        query: {
          type: 'string',
          description: 'Search query (regex pattern or literal string)',
        },
        searchType: {
          type: 'string',
          enum: ['class', 'method', 'field', 'content', 'all'],
          description: 'Type of search to perform',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Omit for modLoader defaults. Same as decompile_mod_jar if set.',
        },
        modLoader: {
          type: 'string',
          enum: ['fabric', 'neoforge'],
          description: 'When mapping omitted: fabric (default) → yarn; neoforge → mojmap',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50)',
        },
      },
      required: ['modId', 'modVersion', 'query', 'searchType'],
    },
  },
  {
    name: 'index_mod',
    description:
      'Index decompiled mod source for search_mod_indexed. After decompile_mod_jar: same mapping as decompile, or modLoader only (neoforge → mojmap, fabric → yarn).',
    inputSchema: {
      type: 'object',
      properties: {
        modId: {
          type: 'string',
          description: 'Mod ID',
        },
        modVersion: {
          type: 'string',
          description: 'Mod version',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Omit for modLoader defaults. Must match decompile_mod_jar if set.',
        },
        modLoader: {
          type: 'string',
          enum: ['fabric', 'neoforge'],
          description: 'When mapping omitted: fabric (default) → yarn; neoforge → mojmap',
        },
        force: {
          type: 'boolean',
          description: 'Force re-indexing even if already indexed (default: false)',
        },
      },
      required: ['modId', 'modVersion'],
    },
  },
  {
    name: 'search_mod_indexed',
    description:
      'Fast full-text search using pre-built mod index. Much faster than search_mod_code for large queries. Requires index_mod first. Supports FTS5 syntax: AND, OR, NOT, "phrase", prefix*.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (supports FTS5 syntax: AND, OR, NOT, "phrase", prefix*)',
        },
        modId: {
          type: 'string',
          description: 'Mod ID',
        },
        modVersion: {
          type: 'string',
          description: 'Mod version',
        },
        mapping: {
          type: 'string',
          enum: ['yarn', 'mojmap'],
          description: 'Omit for modLoader defaults. Must match index_mod if set.',
        },
        modLoader: {
          type: 'string',
          enum: ['fabric', 'neoforge'],
          description: 'When mapping omitted: fabric (default) → yarn; neoforge → mojmap',
        },
        types: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['class', 'method', 'field'],
          },
          description: 'Entry types to search (omit for all types)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 100)',
        },
      },
      required: ['query', 'modId', 'modVersion'],
    },
  },
  {
    name: 'decompile_neoforge_api',
    description:
      'Download NeoForge universal JAR for a Minecraft version and decompile it to Java sources (net.neoforged API). Use alongside decompile_minecraft_version with mojmap for vanilla + NeoForge development. Caches under AppData.',
    inputSchema: {
      type: 'object',
      properties: {
        mcVersion: { type: 'string', description: 'Minecraft version (e.g. 1.21.1)' },
        neoForgeVersion: {
          type: 'string',
          description: 'Full Maven version or omit for latest matching MC',
        },
        force: { type: 'boolean', description: 'Re-decompile even if cache exists' },
      },
      required: ['mcVersion'],
    },
  },
  {
    name: 'index_neoforge_api',
    description:
      'Build FTS5 search index for decompiled NeoForge API sources. Runs decompile_neoforge_api first if needed. Pair with search_neoforge_api.',
    inputSchema: {
      type: 'object',
      properties: {
        mcVersion: { type: 'string', description: 'Minecraft version' },
        neoForgeVersion: { type: 'string', description: 'NeoForge Maven version or omit to resolve' },
        force: { type: 'boolean', description: 'Force re-decompile and re-index' },
      },
      required: ['mcVersion'],
    },
  },
  {
    name: 'search_neoforge_api',
    description:
      'Full-text search in indexed NeoForge API sources (requires index_neoforge_api). FTS5 syntax.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'FTS5 search query' },
        mcVersion: { type: 'string', description: 'Minecraft version' },
        neoForgeVersion: {
          type: 'string',
          description: 'Indexed NeoForge version or omit for latest indexed',
        },
        types: {
          type: 'array',
          items: { type: 'string', enum: ['class', 'method', 'field'] },
        },
        limit: { type: 'number', description: 'Max results (default 100)' },
      },
      required: ['query', 'mcVersion'],
    },
  },
];

// Tool handlers
export async function handleGetMinecraftSource(args: unknown) {
  const { version, className, mapping, startLine, endLine, maxLines } =
    GetMinecraftSourceSchema.parse(args);

  logger.info(
    `Getting source for ${className} in ${version} (${mapping})${startLine ? ` from line ${startLine}` : ''}${endLine ? ` to line ${endLine}` : ''}${maxLines ? ` max ${maxLines} lines` : ''}`,
  );

  const decompileService = getDecompileService();

  try {
    const fullSource = await decompileService.getClassSource(
      version,
      className,
      mapping as MappingType,
    );

    // Apply line filtering if any filter parameters are provided
    let filteredSource = fullSource;
    let totalLines = 0;
    let returnedLines = 0;
    let actualStartLine = 1;
    let actualEndLine = 0;

    if (startLine !== undefined || endLine !== undefined || maxLines !== undefined) {
      const lines = fullSource.split('\n');
      totalLines = lines.length;

      // Calculate effective start and end indices (convert to 0-indexed)
      const effectiveStart = startLine !== undefined ? Math.max(0, startLine - 1) : 0;
      const effectiveEnd = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;

      // Slice the lines based on startLine and endLine
      let filteredLines = lines.slice(effectiveStart, effectiveEnd);

      // Apply maxLines limit if specified
      if (maxLines !== undefined && filteredLines.length > maxLines) {
        filteredLines = filteredLines.slice(0, maxLines);
      }

      filteredSource = filteredLines.join('\n');
      returnedLines = filteredLines.length;
      actualStartLine = effectiveStart + 1;
      actualEndLine = effectiveStart + returnedLines;

      // Build metadata header for filtered results
      const metadataLines = [
        `// Source: ${className}`,
        `// Version: ${version} (${mapping})`,
        `// Lines: ${actualStartLine}-${actualEndLine} of ${totalLines} total`,
        startLine !== undefined || endLine !== undefined || maxLines !== undefined
          ? `// Filtered: startLine=${startLine ?? 1}, endLine=${endLine ?? totalLines}, maxLines=${maxLines ?? 'none'}`
          : '',
        '',
      ].filter(Boolean);

      filteredSource = metadataLines.join('\n') + filteredSource;
    }

    return {
      content: [
        {
          type: 'text',
          text: filteredSource,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to get source', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleDecompileMinecraftVersion(args: unknown) {
  const { version, mapping, force } = DecompileMinecraftVersionSchema.parse(args);

  logger.info(`Decompiling ${version} with ${mapping} mappings`);

  const decompileService = getDecompileService();

  // TODO: Handle force flag by clearing cache
  if (force) {
    logger.warn('Force flag not yet implemented');
  }

  try {
    let totalClasses = 0;

    const outputDir = await decompileService.decompileVersion(
      version,
      mapping as MappingType,
      (_current, total) => {
        totalClasses = total;
      },
    );

    return {
      content: [
        {
          type: 'text',
          text: `Decompilation completed successfully!\n\nVersion: ${version}\nMapping: ${mapping}\nClasses: ${totalClasses}\nOutput: ${outputDir}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Decompilation failed', error);
    return {
      content: [
        {
          type: 'text',
          text: `Decompilation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleListMinecraftVersions() {
  logger.info('Listing Minecraft versions');

  const versionManager = getVersionManager();

  try {
    const cached = versionManager.listCachedVersions();
    const available = await versionManager.listAvailableVersions();

    // Get latest 20 releases for brevity
    const recentReleases = available.slice(0, 20);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              cached,
              available: recentReleases,
              total_available: available.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to list versions', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleGetRegistryData(args: unknown) {
  const { version, registry } = GetRegistryDataSchema.parse(args);

  logger.info(`Getting registry data for ${version}${registry ? ` (${registry})` : ''}`);

  const registryService = getRegistryService();

  try {
    const data = await registryService.getRegistryData(version, registry);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to get registry data', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for remap_mod_jar
export async function handleRemapModJar(args: unknown) {
  const {
    inputJar,
    outputJar,
    mcVersion: providedMcVersion,
    toMapping,
    modLoader = 'fabric',
  } = RemapModJarSchema.parse(args);

  if (modLoader === 'neoforge') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              modLoader: 'neoforge',
              message:
                'This tool remaps Fabric-style mod JARs from intermediary to yarn/mojmap. NeoForge/MDK builds are not remapped the same way; use Gradle in your mod project, or decompile_mod_jar with mapping mojmap for reading sources.',
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  // Normalize paths for cross-platform support (WSL/Windows)
  const normalizedInputJar = normalizePath(inputJar);
  const normalizedOutputJar = normalizePath(outputJar);

  logger.info(`Remapping mod JAR: ${normalizedInputJar} -> ${normalizedOutputJar}`);

  const remapService = getRemapService();
  const modAnalyzerService = getModAnalyzerService();

  try {
    // Check input file exists
    if (!existsSync(normalizedInputJar)) {
      throw new Error(`Input JAR not found: ${normalizedInputJar}`);
    }

    // Auto-detect Minecraft version if not provided
    let mcVersion = providedMcVersion;
    if (!mcVersion) {
      logger.info('Minecraft version not provided, attempting auto-detection from mod metadata');
      const analysis = await modAnalyzerService.analyzeMod(normalizedInputJar);

      // Find minecraft dependency
      const minecraftDep = analysis.dependencies?.find((dep) => dep.modId === 'minecraft');
      if (!minecraftDep || !minecraftDep.versionRange) {
        throw new Error(
          'Could not auto-detect Minecraft version from mod metadata. Please provide mcVersion parameter explicitly.',
        );
      }

      // Extract version from range (e.g., "1.21.11" from "1.21.11" or ">=1.21.0")
      mcVersion = minecraftDep.versionRange.replace(/[><=~^]/g, '').trim();
      logger.info(`Auto-detected Minecraft version: ${mcVersion}`);
    }

    const result = await remapService.remapModJar(
      normalizedInputJar,
      normalizedOutputJar,
      mcVersion,
      toMapping as MappingType,
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              outputJar: result,
              inputJar,
              mcVersion,
              mapping: toMapping,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to remap mod JAR', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for find_mapping
export async function handleFindMapping(args: unknown) {
  const { symbol, version, sourceMapping, targetMapping } = FindMappingSchema.parse(args);

  logger.info(`Looking up mapping: ${symbol} (${sourceMapping} -> ${targetMapping})`);

  const mappingService = getMappingService();

  try {
    const result = await mappingService.lookupMapping(
      version,
      symbol,
      sourceMapping as MappingType,
      targetMapping as MappingType,
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to find mapping', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for search_minecraft_code
export async function handleSearchMinecraftCode(args: unknown) {
  const { version, query, searchType, mapping, limit = 50 } = SearchMinecraftCodeSchema.parse(args);

  logger.info(`Searching Minecraft code: ${query} (${searchType}) in ${version}/${mapping}`);

  const cacheManager = getCacheManager();

  try {
    // Check if decompiled source exists
    if (!cacheManager.hasDecompiledSource(version, mapping)) {
      return {
        content: [
          {
            type: 'text',
            text: `Decompiled source not found for ${version} with ${mapping} mappings. Run decompile_minecraft_version first.`,
          },
        ],
        isError: true,
      };
    }

    const decompiledPath = getDecompiledPath(version, mapping);
    const results: Array<{
      type: string;
      name: string;
      file: string;
      line?: number;
      context?: string;
    }> = [];

    // Recursively search files
    const searchDir = (dir: string) => {
      if (results.length >= limit) return;

      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= limit) break;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          searchDir(fullPath);
        } else if (entry.name.endsWith('.java')) {
          const relativePath = relative(decompiledPath, fullPath);
          const className = relativePath.replace(/\//g, '.').replace(/\.java$/, '');

          // For class search, match against file name
          if (searchType === 'class' || searchType === 'all') {
            const regex = new RegExp(query, 'i');
            if (regex.test(entry.name.replace('.java', ''))) {
              results.push({
                type: 'class',
                name: className,
                file: relativePath,
              });
            }
          }

          // For content/method/field search, read file and search
          if (
            (searchType === 'content' ||
              searchType === 'method' ||
              searchType === 'field' ||
              searchType === 'all') &&
            results.length < limit
          ) {
            const content = readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');
            const regex = new RegExp(query, 'gi');

            for (let i = 0; i < lines.length && results.length < limit; i++) {
              const line = lines[i];
              if (regex.test(line)) {
                // Determine type based on line content
                let type = 'content';
                if (
                  searchType === 'method' ||
                  (searchType === 'all' && /\s+(public|private|protected)\s+.*\(/.test(line))
                ) {
                  type = 'method';
                } else if (
                  searchType === 'field' ||
                  (searchType === 'all' &&
                    /\s+(public|private|protected)\s+\w+\s+\w+\s*[;=]/.test(line))
                ) {
                  type = 'field';
                }

                if (searchType === 'all' || type === searchType || searchType === 'content') {
                  results.push({
                    type,
                    name: className,
                    file: relativePath,
                    line: i + 1,
                    context: line.trim().substring(0, 200),
                  });
                }
              }
            }
          }
        }
      }
    };

    searchDir(decompiledPath);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              query,
              searchType,
              version,
              mapping,
              count: results.length,
              results,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to search code', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for compare_versions
export async function handleCompareVersions(args: unknown) {
  const { fromVersion, toVersion, mapping, category = 'all' } = CompareVersionsSchema.parse(args);

  logger.info(`Comparing versions: ${fromVersion} -> ${toVersion} (${mapping})`);

  const cacheManager = getCacheManager();
  const registryService = getRegistryService();

  try {
    const result: {
      fromVersion: string;
      toVersion: string;
      mapping: string;
      classes?: {
        added: string[];
        removed: string[];
        addedCount: number;
        removedCount: number;
      };
      registry?: {
        added: Record<string, string[]>;
        removed: Record<string, string[]>;
      };
    } = {
      fromVersion,
      toVersion,
      mapping,
    };

    // Compare classes
    if (category === 'classes' || category === 'all') {
      const fromDecompiled = cacheManager.hasDecompiledSource(fromVersion, mapping);
      const toDecompiled = cacheManager.hasDecompiledSource(toVersion, mapping);

      if (fromDecompiled && toDecompiled) {
        const fromPath = getDecompiledPath(fromVersion, mapping);
        const toPath = getDecompiledPath(toVersion, mapping);

        const getClasses = (dir: string): Set<string> => {
          const classes = new Set<string>();
          const walk = (currentDir: string) => {
            const entries = readdirSync(currentDir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = join(currentDir, entry.name);
              if (entry.isDirectory()) {
                walk(fullPath);
              } else if (entry.name.endsWith('.java')) {
                const relativePath = relative(dir, fullPath);
                classes.add(relativePath.replace(/\//g, '.').replace(/\.java$/, ''));
              }
            }
          };
          walk(dir);
          return classes;
        };

        const fromClasses = getClasses(fromPath);
        const toClasses = getClasses(toPath);

        const added = [...toClasses].filter((c) => !fromClasses.has(c));
        const removed = [...fromClasses].filter((c) => !toClasses.has(c));

        result.classes = {
          added: added.slice(0, 100), // Limit to first 100
          removed: removed.slice(0, 100),
          addedCount: added.length,
          removedCount: removed.length,
        };
      } else {
        result.classes = {
          added: [],
          removed: [],
          addedCount: 0,
          removedCount: 0,
        };
      }
    }

    // Compare registries
    if (category === 'registry' || category === 'all') {
      try {
        const fromRegistry = (await registryService.getRegistryData(fromVersion)) as Record<
          string,
          unknown
        >;
        const toRegistry = (await registryService.getRegistryData(toVersion)) as Record<
          string,
          unknown
        >;

        const added: Record<string, string[]> = {};
        const removed: Record<string, string[]> = {};

        // Compare each registry type
        const allKeys = new Set([...Object.keys(fromRegistry), ...Object.keys(toRegistry)]);

        for (const key of allKeys) {
          const fromEntries = new Set(
            Object.keys((fromRegistry[key] as Record<string, unknown>) || {}),
          );
          const toEntries = new Set(
            Object.keys((toRegistry[key] as Record<string, unknown>) || {}),
          );

          const addedEntries = [...toEntries].filter((e) => !fromEntries.has(e));
          const removedEntries = [...fromEntries].filter((e) => !toEntries.has(e));

          if (addedEntries.length > 0) {
            added[key] = addedEntries.slice(0, 20);
          }
          if (removedEntries.length > 0) {
            removed[key] = removedEntries.slice(0, 20);
          }
        }

        result.registry = { added, removed };
      } catch {
        result.registry = { added: {}, removed: {} };
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to compare versions', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Phase 2 Tool Handlers

// Handler for analyze_mixin
export async function handleAnalyzeMixin(args: unknown) {
  const { source, mcVersion, mapping, modLoader } = AnalyzeMixinSchema.parse(args);

  logger.info(`Analyzing mixin for MC ${mcVersion} (${mapping}, modLoader=${modLoader})`);

  const mixinService = getMixinService();

  try {
    // Normalize path for cross-platform support (WSL/Windows)
    // Only normalize if it looks like a file path
    const normalizedSource = normalizePath(source);

    // Check if source is a file path or actual source code
    let mixin: MixinClass | null = null;
    if (existsSync(normalizedSource)) {
      // It's a path - could be JAR, directory, or single file
      if (normalizedSource.endsWith('.jar')) {
        const jarAnalysis = await mixinService.analyzeMixinsFromJar(normalizedSource);

        if (jarAnalysis.validationLevel === 'none') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: 'No mixin configs or Java mixin sources found in JAR',
                    configPaths: jarAnalysis.configPaths,
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        if (jarAnalysis.validationLevel === 'partial') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    validationLevel: 'partial',
                    modLoader,
                    mapping,
                    configPaths: jarAnalysis.configPaths,
                    mixinClassNamesFromConfig: jarAnalysis.mixinClassNamesFromConfig,
                    note: jarAnalysis.note,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const { mixins } = jarAnalysis;
        const results = await Promise.all(
          mixins.map((m) => mixinService.validateMixin(m, mcVersion, mapping as MappingType)),
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  validationLevel: 'full',
                  modLoader,
                  mapping,
                  configPaths: jarAnalysis.configPaths,
                  totalMixins: mixins.length,
                  validMixins: results.filter((r) => r.isValid).length,
                  invalidMixins: results.filter((r) => !r.isValid).length,
                  results,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
      if (normalizedSource.endsWith('.java')) {
        const sourceCode = readFileSync(normalizedSource, 'utf8');
        mixin = mixinService.parseMixinSource(sourceCode, normalizedSource);
      } else {
        // Assume directory
        const mixins = mixinService.parseMixinsFromDirectory(normalizedSource);
        const results = await Promise.all(
          mixins.map((m) => mixinService.validateMixin(m, mcVersion, mapping as MappingType)),
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  totalMixins: mixins.length,
                  validMixins: results.filter((r) => r.isValid).length,
                  invalidMixins: results.filter((r) => !r.isValid).length,
                  results,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    } else {
      // Assume it's source code
      mixin = mixinService.parseMixinSource(source);
    }

    if (!mixin) {
      return {
        content: [{ type: 'text', text: 'No @Mixin annotation found in source' }],
        isError: true,
      };
    }

    const result = await mixinService.validateMixin(mixin, mcVersion, mapping as MappingType);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to analyze mixin', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for validate_access_widener
export async function handleValidateAccessWidener(args: unknown) {
  const { content, mcVersion, mapping = 'yarn', modLoader = 'fabric' } =
    ValidateAccessWidenerSchema.parse(args);

  if (modLoader === 'neoforge') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              skipped: true,
              reason:
                'Fabric Access Widener files (.accesswidener v2, header accessWidener) are not NeoForge Access Transformers.',
              useInstead: 'validate_access_transformer',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  logger.info(`Validating access widener for MC ${mcVersion} (${mapping})`);

  const awService = getAccessWidenerService();

  try {
    // Normalize path for cross-platform support (WSL/Windows)
    const normalizedContent = normalizePath(content);

    let accessWidener: AccessWidener;

    // Check if content is a file path
    if (existsSync(normalizedContent)) {
      accessWidener = awService.parseAccessWidenerFile(normalizedContent);
    } else {
      accessWidener = awService.parseAccessWidener(content);
    }

    const validation = await awService.validateAccessWidener(
      accessWidener,
      mcVersion,
      mapping as MappingType,
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              accessWidener: {
                namespace: accessWidener.namespace,
                version: accessWidener.version,
                entryCount: accessWidener.entries.length,
              },
              validation,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to validate access widener', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for validate_access_transformer (Forge / NeoForge AT)
export async function handleValidateAccessTransformer(args: unknown) {
  const { content, mcVersion, mapping = 'mojmap' } = ValidateAccessTransformerSchema.parse(args);

  logger.info(`Validating access transformer for MC ${mcVersion} (${mapping})`);

  const atService = getAccessTransformerService();

  try {
    const normalizedContent = normalizePath(content);
    const text = existsSync(normalizedContent) ? readFileSync(normalizedContent, 'utf8') : content;
    const { lines, errors: parseFormErrors } = atService.parseFile(
      text,
      existsSync(normalizedContent) ? normalizedContent : undefined,
    );
    const validation = await atService.validateAgainstMinecraft(
      lines,
      mcVersion,
      mapping as MappingType,
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              kind: 'access_transformer',
              entryCount: lines.length,
              parseFormErrors,
              classValidation: validation,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to validate access transformer', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for compare_versions_detailed
export async function handleCompareVersionsDetailed(args: unknown) {
  const { fromVersion, toVersion, mapping, packages, maxClasses } =
    CompareVersionsDetailedSchema.parse(args);

  logger.info(`Comparing ${fromVersion} vs ${toVersion} (detailed, ${mapping})`);

  const astDiffService = getAstDiffService();

  try {
    const diff = await astDiffService.compareVersionsDetailed(
      fromVersion,
      toVersion,
      mapping as MappingType,
      { packages, maxClasses },
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(diff, null, 2),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to compare versions', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for index_minecraft_version
export async function handleIndexVersion(args: unknown) {
  const { version, mapping } = IndexVersionSchema.parse(args);

  logger.info(`Indexing ${version}/${mapping}`);

  const searchService = getSearchIndexService();

  try {
    // Check if already indexed
    if (searchService.isIndexed(version, mapping as MappingType)) {
      const stats = searchService.getStats(version, mapping as MappingType);
      return {
        content: [
          {
            type: 'text',
            text: `Version ${version}/${mapping} is already indexed.\n\nStats:\n${JSON.stringify(stats, null, 2)}`,
          },
        ],
      };
    }

    const result = await searchService.indexVersion(
      version,
      mapping as MappingType,
      (current, total, className) => {
        if (current % 100 === 0) {
          logger.info(`Indexing: ${current}/${total} - ${className}`);
        }
      },
    );

    return {
      content: [
        {
          type: 'text',
          text: `Indexing complete!\n\nFiles indexed: ${result.fileCount}\nDuration: ${result.duration}ms`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to index version', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for search_indexed
export async function handleSearchIndexed(args: unknown) {
  const { query, version, mapping, types, limit = 100 } = SearchIndexedSchema.parse(args);

  logger.info(`Searching indexed: ${query} in ${version}/${mapping}`);

  const searchService = getSearchIndexService();

  try {
    const results = searchService.search(query, version, mapping as MappingType, {
      types: types as Array<'class' | 'method' | 'field'>,
      limit,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              query,
              version,
              mapping,
              count: results.length,
              results,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to search', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for get_documentation
export async function handleGetDocumentation(args: unknown) {
  const { className, modLoader, mcVersion } = GetDocumentationSchema.parse(args);

  logger.info(`Getting documentation for ${className} (${modLoader})`);

  const docService = getDocumentationService();

  try {
    const docs = await docService.getRelatedDocumentation(className, modLoader, mcVersion);

    if (docs.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No documentation found for ${className} (modLoader=${modLoader})`,
          },
        ],
      };
    }

    const resolvedNeoforgedDocsVersion =
      modLoader === 'neoforge' ? resolveNeoforgedDocsVersion(mcVersion) : undefined;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              modLoader,
              className,
              mcVersion,
              resolvedNeoforgedDocsVersion,
              results: docs,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to get documentation', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for search_documentation
export async function handleSearchDocumentation(args: unknown) {
  const { query, modLoader, mcVersion } = SearchDocumentationSchema.parse(args);

  logger.info(`Searching documentation: ${query} (${modLoader})`);

  const docService = getDocumentationService();

  try {
    const results = docService.searchDocumentation(query, modLoader, mcVersion);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              query,
              modLoader,
              mcVersion,
              resolvedNeoforgedDocsVersion:
                modLoader === 'neoforge' ? resolveNeoforgedDocsVersion(mcVersion) : undefined,
              count: results.length,
              results,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to search documentation', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Phase 3 Tool Handlers

// Handler for analyze_mod_jar
export async function handleAnalyzeModJar(args: unknown) {
  const { jarPath, includeAllClasses, includeRawMetadata } = AnalyzeModJarSchema.parse(args);

  // Normalize path for cross-platform support (WSL/Windows)
  const normalizedJarPath = normalizePath(jarPath);

  logger.info(`Analyzing mod JAR: ${normalizedJarPath}`);

  const modAnalyzer = getModAnalyzerService();

  try {
    // Check file exists
    if (!existsSync(normalizedJarPath)) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: JAR file not found: ${normalizedJarPath}`,
          },
        ],
        isError: true,
      };
    }

    const result = await modAnalyzer.analyzeMod(normalizedJarPath, {
      includeAllClasses,
      includeRawMetadata,
      analyzeBytecode: true,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to analyze mod JAR', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for decompile_mod_jar
export async function handleDecompileModJar(args: unknown) {
  const { jarPath, mapping, modId, modVersion } = DecompileModJarSchema.parse(args);

  // Normalize path for cross-platform support (WSL/Windows)
  const normalizedJarPath = normalizePath(jarPath);

  logger.info(
    `Decompiling mod JAR: ${normalizedJarPath} with ${mapping} mappings${modId ? ` (${modId}${modVersion ? `:${modVersion}` : ''})` : ''}`,
  );

  const modDecompileService = getModDecompileService();

  try {
    // Check file exists
    if (!existsSync(normalizedJarPath)) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: JAR file not found: ${normalizedJarPath}`,
          },
        ],
        isError: true,
      };
    }

    const result = await modDecompileService.decompileMod(
      normalizedJarPath,
      mapping as MappingType,
      modId,
      modVersion,
      (current, total) => {
        if (current % 500 === 0 || current === total) {
          logger.info(
            `Decompiling: ${current}/${total} classes (${((current / total) * 100).toFixed(1)}%)`,
          );
        }
      },
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              modId: result.modId,
              modVersion: result.modVersion,
              mapping,
              outputDirectory: result.outputDir,
              message: `Successfully decompiled ${result.modId} v${result.modVersion} to ${result.outputDir}`,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to decompile mod JAR', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for index_mod
export async function handleIndexMod(args: unknown) {
  const { modId, modVersion, mapping, force = false } = IndexModSchema.parse(args);

  logger.info(`Indexing mod ${modId}:${modVersion}/${mapping}`);

  const searchIndexService = getSearchIndexService();

  try {
    // Check if already indexed
    if (!force && searchIndexService.isModIndexed(modId, modVersion, mapping as MappingType)) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: `Mod ${modId} v${modVersion} with ${mapping} mappings is already indexed. Use force=true to re-index.`,
                modId,
                modVersion,
                mapping,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const result = await searchIndexService.indexMod(
      modId,
      modVersion,
      mapping as MappingType,
      (current, total, className) => {
        if (current % 100 === 0 || current === total) {
          logger.info(
            `Indexing: ${current}/${total} files (${((current / total) * 100).toFixed(1)}%) - ${className}`,
          );
        }
      },
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              modId,
              modVersion,
              mapping,
              filesIndexed: result.fileCount,
              durationMs: result.duration,
              message: `Successfully indexed ${result.fileCount} files in ${result.duration}ms`,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to index mod', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleDecompileNeoforgeApi(args: unknown) {
  const { mcVersion, neoForgeVersion, force } = DecompileNeoforgeApiSchema.parse(args);
  const svc = getNeoForgeDecompileService();
  try {
    const { outputDir, neoForgeVersion: resolved, jarPath } = await svc.decompileApi(
      mcVersion,
      neoForgeVersion,
      { force },
    );
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              mcVersion,
              neoForgeVersion: resolved,
              jarPath,
              outputDir,
              message: `NeoForge API sources ready at ${outputDir}`,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('decompile_neoforge_api failed', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleIndexNeoforgeApi(args: unknown) {
  const { mcVersion, neoForgeVersion, force } = IndexNeoforgeApiSchema.parse(args);
  const dl = getNeoForgeDownloader();
  const neoSvc = getNeoForgeDecompileService();
  const search = getSearchIndexService();
  try {
    const resolved = await dl.resolveNeoForgeVersion(mcVersion, neoForgeVersion);
    await neoSvc.decompileApi(mcVersion, resolved, { force: force ?? false });
    const result = await search.indexNeoforgeApi(mcVersion, resolved);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              mcVersion,
              neoForgeVersion: resolved,
              filesIndexed: result.fileCount,
              durationMs: result.duration,
              message: `Indexed ${result.fileCount} NeoForge API files`,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('index_neoforge_api failed', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

export async function handleSearchNeoforgeApi(args: unknown) {
  const { query, mcVersion, neoForgeVersion, types, limit = 100 } =
    SearchNeoforgeApiSchema.parse(args);
  const search = getSearchIndexService();
  try {
    let neo = neoForgeVersion?.trim();
    if (!neo) {
      neo = search.getLatestIndexedNeoForgeVersion(mcVersion);
      if (!neo) {
        return {
          content: [
            {
              type: 'text',
              text: `No NeoForge API index for MC ${mcVersion}. Run index_neoforge_api first (optionally pass neoForgeVersion).`,
            },
          ],
          isError: true,
        };
      }
    }
    const results = search.searchNeoforgeApi(query, mcVersion, neo, {
      types: types as Array<'class' | 'method' | 'field'> | undefined,
      limit,
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { query, mcVersion, neoForgeVersion: neo, count: results.length, results },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('search_neoforge_api failed', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for search_mod_indexed
export async function handleSearchModIndexed(args: unknown) {
  const {
    query,
    modId,
    modVersion,
    mapping,
    types,
    limit = 100,
  } = SearchModIndexedSchema.parse(args);

  logger.info(`Searching mod indexed: ${query} in ${modId}:${modVersion}/${mapping}`);

  const searchIndexService = getSearchIndexService();

  try {
    const results = searchIndexService.searchMod(query, modId, modVersion, mapping as MappingType, {
      types: types as Array<'class' | 'method' | 'field'> | undefined,
      limit,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              query,
              modId,
              modVersion,
              mapping,
              count: results.length,
              results,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to search mod indexed', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Handler for search_mod_code
export async function handleSearchModCode(args: unknown) {
  const {
    modId,
    modVersion,
    query,
    searchType,
    mapping,
    limit = 50,
  } = SearchModCodeSchema.parse(args);

  logger.info(`Searching mod code: ${query} (${searchType}) in ${modId}:${modVersion}/${mapping}`);

  const cacheManager = getCacheManager();

  try {
    // Check if decompiled mod source exists
    if (!cacheManager.hasDecompiledModSource(modId, modVersion, mapping)) {
      return {
        content: [
          {
            type: 'text',
            text: `Decompiled source not found for mod ${modId} v${modVersion} with ${mapping} mappings. Run decompile_mod_jar first.`,
          },
        ],
        isError: true,
      };
    }

    const decompiledPath = cacheManager.getDecompiledModSourcePath(modId, modVersion, mapping);
    const results: Array<{
      type: string;
      name: string;
      file: string;
      line?: number;
      context?: string;
    }> = [];

    // Recursively search files
    const searchDir = (dir: string) => {
      if (results.length >= limit) return;

      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= limit) break;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          searchDir(fullPath);
        } else if (entry.name.endsWith('.java')) {
          const relativePath = relative(decompiledPath, fullPath);
          const className = relativePath.replace(/\//g, '.').replace(/\.java$/, '');

          // For class search, match against file name
          if (searchType === 'class' || searchType === 'all') {
            const regex = new RegExp(query, 'i');
            if (regex.test(entry.name.replace('.java', ''))) {
              results.push({
                type: 'class',
                name: className,
                file: relativePath,
              });
            }
          }

          // For content/method/field search, read file and search
          if (
            (searchType === 'content' ||
              searchType === 'method' ||
              searchType === 'field' ||
              searchType === 'all') &&
            results.length < limit
          ) {
            const content = readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');
            const regex = new RegExp(query, 'gi');

            for (let i = 0; i < lines.length && results.length < limit; i++) {
              const line = lines[i];
              if (regex.test(line)) {
                // Determine type based on line content
                let type = 'content';
                if (
                  searchType === 'method' ||
                  (searchType === 'all' && /\s+(public|private|protected)\s+.*\(/.test(line))
                ) {
                  type = 'method';
                } else if (
                  searchType === 'field' ||
                  (searchType === 'all' &&
                    /\s+(public|private|protected)\s+\w+\s+\w+\s*[;=]/.test(line))
                ) {
                  type = 'field';
                }

                if (searchType === 'all' || type === searchType || searchType === 'content') {
                  results.push({
                    type,
                    name: className,
                    file: relativePath,
                    line: i + 1,
                    context: line.trim().substring(0, 200),
                  });
                }
              }
            }
          }
        }
      }
    };

    searchDir(decompiledPath);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              query,
              searchType,
              modId,
              modVersion,
              mapping,
              count: results.length,
              results,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to search mod code', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

// Tool router
export async function handleToolCall(name: string, args: unknown) {
  switch (name) {
    case 'get_minecraft_source':
      return handleGetMinecraftSource(args);
    case 'decompile_minecraft_version':
      return handleDecompileMinecraftVersion(args);
    case 'list_minecraft_versions':
      return handleListMinecraftVersions();
    case 'get_registry_data':
      return handleGetRegistryData(args);
    case 'remap_mod_jar':
      return handleRemapModJar(args);
    case 'find_mapping':
      return handleFindMapping(args);
    case 'search_minecraft_code':
      return handleSearchMinecraftCode(args);
    case 'compare_versions':
      return handleCompareVersions(args);
    // Phase 2 tools
    case 'analyze_mixin':
      return handleAnalyzeMixin(args);
    case 'validate_access_widener':
      return handleValidateAccessWidener(args);
    case 'validate_access_transformer':
      return handleValidateAccessTransformer(args);
    case 'compare_versions_detailed':
      return handleCompareVersionsDetailed(args);
    case 'index_minecraft_version':
      return handleIndexVersion(args);
    case 'search_indexed':
      return handleSearchIndexed(args);
    case 'get_documentation':
      return handleGetDocumentation(args);
    case 'search_documentation':
      return handleSearchDocumentation(args);
    // Phase 3 tools
    case 'analyze_mod_jar':
      return handleAnalyzeModJar(args);
    case 'decompile_mod_jar':
      return handleDecompileModJar(args);
    case 'search_mod_code':
      return handleSearchModCode(args);
    case 'index_mod':
      return handleIndexMod(args);
    case 'search_mod_indexed':
      return handleSearchModIndexed(args);
    case 'decompile_neoforge_api':
      return handleDecompileNeoforgeApi(args);
    case 'index_neoforge_api':
      return handleIndexNeoforgeApi(args);
    case 'search_neoforge_api':
      return handleSearchNeoforgeApi(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** Exported for unit tests (modLoader + default mapping). */
export {
  DecompileModJarSchema,
  IndexModSchema,
  SearchModCodeSchema,
  SearchModIndexedSchema,
};
