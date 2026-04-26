# Claude Code Context - Minecraft Dev MCP

This document provides essential context for working with the Minecraft Dev MCP codebase.

## This repository (fork)

This checkout is the **NeoForge-oriented fork**: [maurovideosmr-wq/minecraft-dev-mcp-neoforge](https://github.com/maurovideosmr-wq/minecraft-dev-mcp-neoforge). The original project is [MCDxAI/minecraft-dev-mcp](https://github.com/MCDxAI/minecraft-dev-mcp). Use `upstream` to pull official changes (`git fetch upstream` then merge/rebase).

**Differences from upstream (summary)** — in addition to shared MCP core: NeoForge API download/decompile/index/search (`decompile_neoforge_api`, `index_neoforge_api`, `search_neoforge_api`); `validate_access_transformer` (Forge/NeoForge AT, not Fabric widener); `mixin-config-reader` and mixin service updates; `forge-toml-blocks` for `mods.toml` / dependency / mixin / AT file lists; `neoforge-downloader` + `neoforge-decompile-service`; more defensive **Mojang client/server JAR** downloads (SHA-1 verify, retry with refreshed `version.json`); default `**npm test`** uses `vitest.quick.config.ts` (no integration/manual networking-heavy cases); script `scripts/redownload-minecraft-server.ts` to re-download a server JAR into cache.

## Project Overview

This is a **Model Context Protocol (MCP) server** that provides AI assistants with access to decompiled Minecraft source code, registry data, and modding tools. It enables LLMs to help developers with Minecraft mod development by providing accurate, version-specific source code and game data.

## Release Status

- **Phase 1 & 2 complete** (core services, remap/decompile/search/compare) as of 2025-12-06; 29 integration tests pass end-to-end.
- **Phase 3 complete** (third-party mod analysis) as of 2025-12-15; includes full mod decompilation, search, and indexing capabilities with WSL support.

## Architecture

### Core Services (`src/services/`)

1. **version-manager.ts** - Downloads and manages Minecraft client/server JARs from Mojang
  - `getVersionJar()` - Downloads client JAR (for remapping/decompilation)
  - `getServerJar()` - Downloads server JAR (for registry extraction)
  - Caches JARs in AppData/config directory
2. **mapping-service.ts** - Downloads and manages mappings (Yarn, Mojmap, Intermediary)
  - Yarn: Community mappings (best for mod development)
  - Mojmap: Official Mojang mappings
  - Intermediary: Fabric's stable intermediate mapping format
3. **remap-service.ts** - Remaps obfuscated Minecraft JARs using mappings
  - Uses tiny-remapper Java tool
  - Converts obfuscated names → human-readable names
  - **Yarn requires 2-step remapping**: obfuscated → intermediary → yarn
4. **decompile-service.ts** - Decompiles remapped JARs to Java source
  - Uses VineFlower decompiler
  - Produces readable Java source code
  - Caches decompiled sources for reuse
5. **registry-service.ts** - Extracts Minecraft registry data (blocks, items, entities, etc.)
  - **CRITICAL**: Must use SERVER JAR, not client JAR
  - Uses Minecraft's built-in data generator (`--reports` flag)
  - Handles both modern (1.18+) and legacy (<1.18) formats
6. **source-service.ts** - Main orchestration service
  - Coordinates version management → remapping → decompilation
  - Provides `getMinecraftSource()` for retrieving specific class source code
  - Handles caching and progress reporting
7. **neoforge-decompile-service.ts** (fork) - Downloads NeoForge universal JAR, decompiles to `decompiled-neoforge/{mcVersion}/{neoForgeVersion}/`
8. **access-transformer-service.ts** (fork) - Parse/validate Forge/NeoForge `.cfg` Access Transformers; can cross-check class names against decompiled vanilla when mapping is mojmap
9. **mixin-service.ts** + **mixin-config-reader.ts** (fork) - Mixin analysis with improved config discovery/parsing

**TOML helpers (fork)**: `src/utils/forge-toml-blocks.ts` — split `[[mods]]` / `[[dependencies.*]]` / mixin configs / `[[accessTransformers]]` from Forge/NeoForge TOML for `mod-analyzer-service` and related tools.

### Java Tool Wrappers (`src/java/`)

1. **tiny-remapper.ts** - Wraps tiny-remapper JAR for remapping obfuscated classes
  - Handles namespace conversions (official → intermediary → named)
  - Uses tiny-remapper 0.12.0 (multi-threaded ASM remapper)
2. **vineflower.ts** - Wraps VineFlower JAR for decompilation
  - **Creates temporary folders**: `libraries/`, `versions/`, `logs/` in CWD during decompilation
  - These are VineFlower's workspace files and should be gitignored
  - Defaults align with Vineflower 1.11.2 (`-dgs=1 -hdc=0 -asc=1 -rsy=1 -lit=1`)
3. **mc-data-gen.ts** - Runs Minecraft's data generator to extract registry data
  - **MC 1.18+**: Uses bundler format: `java -DbundlerMainClass=net.minecraft.data.Main -jar server.jar`
  - **MC <1.18**: Uses legacy format: `java -cp server.jar net.minecraft.data.Main`
  - Checks multiple locations for `registries.json`:
    - MC 1.21+: `reports/registries.json`
    - MC <1.21: `generated/reports/registries.json`
4. **java-process.ts** - Low-level Java process execution wrapper
  - Supports both `-jar` and `-cp` modes
  - Handles JVM args (e.g., `-DbundlerMainClass`)
  - Provides timeout, progress tracking, and error handling

### Downloaders (`src/downloaders/`)

1. **mojang-downloader.ts** - Downloads JARs and mappings from Mojang
  - `downloadClientJar()` - Client JAR (for playing/remapping)
  - `downloadServerJar()` - Server JAR (for registry extraction)
  - `downloadMojangMappings()` - Official Mojang mappings
  - All downloads include SHA-1 verification; on client/server JAR mismatch, the fork **re-fetches `version.json`**, **deletes the bad file**, and **retries** (handles CDN hiccups and bad partials)
2. **yarn-downloader.ts** - Downloads Yarn mappings from Fabric Maven
  - Uses Maven API to find available versions
  - Downloads and converts to Tiny v2 format
3. **neoforge-downloader.ts** (fork) - Resolves NeoForge universal JAR from NeoForged Maven for `decompile_neoforge_api`
4. **java-resources.ts** - Downloads Java tool JARs (VineFlower, tiny-remapper)
  - Caches in AppData/resources directory

### Cache Management (`src/cache/`)

1. **cache-manager.ts** - High-level cache operations
  - Checks if versions/mappings/decompiled sources exist
  - Returns cached paths
2. **database.ts** - SQLite database for metadata
  - Tracks versions, mappings, decompilation jobs
  - Stores access times for cache cleanup

### Paths and Storage (`src/utils/paths.ts`)

**Cache Directory Structure**:

- Windows: `%APPDATA%\minecraft-dev-mcp\`
- macOS: `~/Library/Application Support/minecraft-dev-mcp/`
- Linux: `~/.config/minecraft-dev-mcp/`

**Subdirectories**:

- `jars/` - Client and server JARs
  - `minecraft_client.{version}.jar`
  - `minecraft_server.{version}.jar`
- `mappings/` - Mapping files (Tiny format)
- `remapped/` - Remapped JARs
- `decompiled/{version}/{mapping}/` - Decompiled source code
- `decompiled-mods/{modId}/{version}/{mapping}/` - Decompiled mod sources (Phase 3)
- `decompiled-neoforge/{mcVersion}/{neoForgeVersion}/` - Decompiled NeoForge API (fork)
- `neoforge/jars/` - Downloaded NeoForge universal JARs (fork)
- `registry/{version}/` - Registry data
- `resources/` - Java tool JARs (VineFlower, tiny-remapper)
- `search_index.db` (cache root) - SQLite with FTS5 tables `search_index`, `mod_search_index`, `neoforge_search_index` (see `search-index-service.ts`)
- `cache.db` - Metadata DB (decompilation jobs, etc.)
- Central cache is shared across workspaces; expect ~400–450 MB per MC version (JAR + mappings + remapped + decompiled + registry).

## Build & ESM Requirements

- ESM-only: `package.json` must keep `"type": "module"`; `tsconfig` uses `"module": "ES2022"`/bundler resolution.
- Local imports must include `.js` extensions after build (e.g., `./utils.js`), not `.ts`.
- No CommonJS `require`; all tooling/scripts assume ES modules.

## Critical Implementation Details

### Registry Extraction (IMPORTANT!)

**Problem Solved**: Registry extraction was failing because it tried to use the remapped client JAR.

**Solution**:

1. **Always use SERVER JAR** - The server JAR has the built-in data generator
2. **Use obfuscated JAR** - Don't remap it, the server JAR runs fine obfuscated
3. **Handle bundler format** - MC 1.18+ uses a bundler format that requires `-DbundlerMainClass`

**Implementation** (`src/services/registry-service.ts`):

```typescript
// Get SERVER JAR (not client!)
const serverJarPath = await this.versionManager.getServerJar(version);

// Run data generator with version-specific format
const registriesFile = await this.dataGen.generateRegistryData(
  serverJarPath,
  registryDir,
  version // Used to detect if bundler format needed
);
```

**Registry Names**:

- Use singular form: `block`, `item`, `entity` (NOT `blocks`, `items`, `entities`)
- Full names include namespace: `minecraft:block`, `minecraft:item`
- The code auto-adds `minecraft:` prefix if not present

### Yarn Mapping Remapping (Two-Step Process)

Yarn mappings require **two separate remapping operations**:

1. **Official → Intermediary**: Remap from obfuscated to Fabric's stable intermediary names
2. **Intermediary → Yarn**: Remap from intermediary to human-readable Yarn names

**Why?** Yarn builds on top of Intermediary to provide stable mappings across Minecraft versions.

**Implementation** (`src/services/remap-service.ts`):

```typescript
// Step 1: official → intermediary
const intermediaryJar = await this.tinyRemapper.remap(
  inputJar,
  intermediaryPath,
  intermediateMappings,
  'official', 'intermediary'
);

// Step 2: intermediary → named (yarn)
const yarnJar = await this.tinyRemapper.remap(
  intermediaryJar,
  outputPath,
  yarnMappings,
  'intermediary', 'named'
);
```

### VineFlower Temporary Files

VineFlower creates these folders in the **current working directory** during decompilation:

- `libraries/` - Extracted Minecraft libraries for dependency resolution
- `versions/` - Minecraft version metadata
- `logs/` - Decompilation logs

**These are temporary and gitignored** - but the actual decompiled sources go to AppData.

## Testing

### Integration Tests (`__tests__/integration.test.ts`)

Tests the entire pipeline end-to-end:

1. Version management (list, download)
2. JAR download and caching
3. Mapping download (Yarn)
4. JAR remapping (Yarn 2-step process)
5. Source code decompilation
6. **Registry extraction** (blocks, items)
7. MCP tool integration
8. Error handling

**Test Configuration**:

- **Default** (`vitest.quick.config.ts`): `npm test` and `npm run test:quick` — excludes `__tests__/integration/`**, `__tests__/manual/**`, and other suites that download JARs or list Mojang versions; short timeouts; suitable for agents/CI that need a fast signal.
- **Full integration** (`vitest.config.ts`): `watch: false`, `testTimeout: 600000` (10 minutes) for long I/O; uses `__tests__/test-constants.ts` (e.g. `TEST_VERSION`).

**Running Tests**:

```bash
npm test                    # Default: quick suite (vitest.quick.config.ts)
npm run test:integration    # Full: JARs, mappings, decompile, registry, integration folder
npm run test:unit           # All tests except __tests__/integration/**
npm run test:manual:neoforge  # NeoForge E2E (MCP_NEOFORGE_E2E=1, manual/neoforge-api)
```

See `package.json` for `test:manual`, `test:manual:mojmap`, and `test:all` (integration + manual).

GitHub Actions (`.github/workflows/test.yml`) runs `**npm run test:integration**` after build — not the quick `npm test` profile.

## Common Tasks

### Adding Support for a New Mapping Type

1. Add the type to `src/types/minecraft.ts`: `MappingType`
2. Create downloader in `src/downloaders/{type}-downloader.ts`
3. Update `mapping-service.ts` to handle the new type
4. Add test cases

### Debugging Registry Extraction Issues

1. Check the Java command being executed (logged by `java-process.ts`)
2. Verify you're using the **server JAR**, not client JAR
3. For MC 1.18+, ensure `-DbundlerMainClass=net.minecraft.data.Main` is present
4. Check `registries.json` location (may be in `reports/` or `generated/reports/`)
5. Verify registry names use singular form (`block` not `blocks`)

### Handling New Minecraft Versions

The code should work automatically, but be aware:

- **MC 1.18+**: Requires bundler format and Java 17+
- **MC 1.21+**: May require Java 21+
- Registry output location may change between versions
- Always test with integration tests

## Error Handling, Security, and Performance Notes

- Network work uses retries/backoff; Java processes run with timeouts and stderr capture.
- Integrity checks: SHA-1/256 verification on downloads; cache rebuild on corruption.
- Security: path traversal guardrails on class names and file writes; Java processes memory-capped.
- Performance: favors lazy decompilation, parallel workers, and LRU-style cache eviction; compress/evict old versions if storage is tight.

## Reference Tools

- FabricMod-Remapper — exemplar for two-phase Yarn remapping strategy (official → intermediary → yarn).
- mojang2tiny — reference implementation for converting Mojang mappings to Tiny v2.
- tiny-remapper — upstream bytecode remapper we wrap; check changelog for behavior changes.

## Architecture Decisions

### Why Server JAR for Registries?

- Server JAR has built-in data generator (`--reports` flag)
- Client JAR doesn't include data generation tools
- Server JAR can run obfuscated (no remapping needed)

### Why Two-Step Remapping for Yarn?

- Yarn builds on Fabric's Intermediary mappings
- Intermediary provides stable names across versions
- This allows Yarn to update names without breaking between Minecraft versions

### Why VineFlower over Fernflower?

- Better Java 17+ support
- More accurate decompilation
- Better performance on large JARs
- Active maintenance

### Why Tiny v2 Format?

- Standard format for Fabric toolchain
- Supports multiple namespaces in one file
- Compact and efficient
- Well-supported by tools

## Troubleshooting

### "Class not found" errors during registry extraction

→ Using client JAR instead of server JAR. Check `registry-service.ts`.

### Yarn remapping fails

→ Ensure two-step process is happening (official → intermediary → yarn).

### Decompilation creates folders in project directory

→ Expected VineFlower behavior. These folders are gitignored.

### Tests timeout

→ First run downloads ~50MB of JARs. Increase timeout or use cached versions.

### "Java version" errors

→ MC 1.18+ requires Java 17+, MC 1.21+ requires Java 21+.

## MCP Tools Reference

### Phase 1 Tools (Core)

1. `**get_minecraft_source`** - Get decompiled source for a Minecraft class
2. `**decompile_minecraft_version`** - Trigger full decompilation of a version
3. `**list_minecraft_versions**` - List available and cached versions
4. `**get_registry_data**` - Get registry data (blocks, items, entities)

### Phase 2 Tools (Advanced Analysis)

1. `**remap_mod_jar**` - Remap Fabric mod JARs to human-readable names
2. `**find_mapping**` - Lookup symbol mappings between namespaces
3. `**search_minecraft_code**` - Regex search in decompiled source
4. `**compare_versions**` - Compare classes/registries between versions
5. `**analyze_mixin**` - Analyze and validate Mixin code
6. `**validate_access_widener**` - Validate access widener files
7. `**compare_versions_detailed**` - AST-level version comparison
8. `**index_minecraft_version**` - Create full-text search index
9. `**search_indexed**` - Fast FTS5 search on indexed versions
10. `**get_documentation**` - Get documentation for a class
11. `**search_documentation**` - Search documentation

### Phase 3 Tools (Mod Analysis)

1. `**analyze_mod_jar**` - Analyze third-party mod JAR files
2. `**decompile_mod_jar**` - Decompile mod JARs to readable Java source (`modLoader` + optional `mapping`; NeoForge defaults to mojmap)
3. `**search_mod_code**` - Search decompiled mod source code
4. `**index_mod**` - Create full-text search index for mod source
5. `**search_mod_indexed**` - Fast FTS5 search on indexed mod source
6. `**validate_access_transformer**` - Parse/validate Forge/NeoForge Access Transformer files (not Fabric access widener)
7. `**decompile_neoforge_api**` - Download NeoForge universal JAR and decompile API sources
8. `**index_neoforge_api**` / `**search_neoforge_api**` - FTS5 index and search on decompiled NeoForge API

#### `analyze_mod_jar` Tool

Analyzes a mod JAR file to extract comprehensive metadata. Supports Fabric, Quilt, Forge, and NeoForge mods.

**Input**:

```typescript
{
  jarPath: string;           // Local path to the mod JAR file
  includeAllClasses?: boolean; // Include full class list (can be large)
  includeRawMetadata?: boolean; // Include raw fabric.mod.json, mixin configs
}
```

**Output** includes:

- **Mod metadata**: ID, version, name, description, authors, license
- **Compatibility**: Minecraft version, loader version, Java version, environment (client/server)
- **Dependencies**: Required, optional, incompatible mods with version constraints
- **Entry points**: Main, client, server initializers with class references
- **Mixins**: Config files, packages, mixin class lists (common/client/server)
- **Class analysis**: Total count, package breakdown, mixin detection via bytecode
- **Nested JARs**: Jar-in-Jar dependencies

**Example usage** (for LLM):

```
analyze_mod_jar({ jarPath: "C:/mods/meteor-client-1.21.10-32.jar" })
```

Returns JSON with full mod analysis including detected loader type, all dependencies, entry points, and mixin configurations.

## Phase 3 Services

### `mod-analyzer-service.ts`

Analyzes third-party mod JARs without requiring Java. Performs:

1. **Loader Detection**: Checks for `fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`
2. **Metadata Parsing**: Extracts mod ID, version, dependencies from loader-specific files
3. **Mixin Analysis**: Parses mixin config JSON files, extracts packages and class lists
4. **Bytecode Analysis**: Scans `.class` files for `@Mixin` annotations in constant pool
5. **Class Statistics**: Counts classes per package, identifies entry points

**Key types** (`src/types/minecraft.ts`):

- `ModLoader`: `'fabric' | 'quilt' | 'forge' | 'neoforge' | 'unknown'`
- `ModAnalysisResult`: Complete analysis output structure
- `ModClass`: Class metadata including mixin detection
- `ModMixinConfig`: Parsed mixin configuration

### `mod-decompile-service.ts`

Decompiles mod JARs to readable Java source code. Supports both original (intermediary) and remapped JARs.

**Key features**:

1. **Auto-detection**: Automatically detects mod ID and version from JAR metadata
2. **Caching**: Decompiled sources cached in `AppData/decompiled-mods/{modId}/{modVersion}/{mapping}/`
3. **Progress tracking**: Database-backed job tracking with progress updates
4. **VineFlower integration**: Reuses same decompiler as Minecraft decompilation
5. **WSL compatibility**: Full support for WSL and Windows path formats

**Workflow**:

1. `remap_mod_jar` - Remap mod JAR from intermediary → yarn/mojmap (optional, can skip if JAR already remapped)
2. `decompile_mod_jar` - Decompile JAR to readable Java source
3. `search_mod_code` OR `index_mod` + `search_mod_indexed` - Search through decompiled source

#### `decompile_mod_jar` Tool

Decompiles a mod JAR file to readable Java source code.

**Input**:

```typescript
{
  jarPath: string;      // Path to mod JAR (WSL or Windows path)
  mapping?: 'yarn' | 'mojmap';  // If omitted, use modLoader: neoforge → mojmap, fabric → yarn
  modLoader?: 'fabric' | 'neoforge';  // Default fabric; only affects mapping when mapping omitted
  modId?: string;       // Optional, auto-detected if not provided
  modVersion?: string;  // Optional, auto-detected if not provided
}
```

**Output**: Decompiled source directory path, mod ID, and version

**Example**:

```
decompile_mod_jar({ jarPath: "C:/mods/meteor-remapped-yarn.jar", mapping: "yarn" })
```

#### `search_mod_code` Tool

Search for classes, methods, fields, or content in decompiled mod source code using regex patterns.

**Input**:

```typescript
{
  modId: string;
  modVersion: string;
  query: string;                    // Regex pattern or literal string
  searchType: 'class' | 'method' | 'field' | 'content' | 'all';
  mapping: 'yarn' | 'mojmap';
  limit?: number;                   // Default: 50
}
```

**Example**:

```
search_mod_code({ modId: "meteor-client", modVersion: "0.5.8", query: "onTick", searchType: "method", mapping: "yarn" })
```

#### `index_mod` Tool

Creates a full-text search index for decompiled mod source code using SQLite FTS5.

**Input**:

```typescript
{
  modId: string;
  modVersion: string;
  mapping: 'yarn' | 'mojmap';
  force?: boolean;  // Force re-indexing, default: false
}
```

**Benefits**: Enables much faster searching via `search_mod_indexed` tool

#### `search_mod_indexed` Tool

Fast full-text search using pre-built mod index. Supports FTS5 syntax.

**Input**:

```typescript
{
  query: string;  // FTS5 syntax: AND, OR, NOT, "phrase", prefix*
  modId: string;
  modVersion: string;
  mapping: 'yarn' | 'mojmap';
  types?: Array<'class' | 'method' | 'field'>;  // Optional filter
  limit?: number;  // Default: 100
}
```

**Example**:

```
search_mod_indexed({ query: "packet AND send", modId: "meteor-client", modVersion: "0.5.8", mapping: "yarn" })
```

## Mod Analysis Use Cases

The Phase 3 mod tools enable:

- **Compatibility analysis**: Understanding how other mods work for interop
- **Learning**: Studying mod development techniques from popular mods
- **Debugging**: Investigating mod interactions and conflicts
- **Educational reference**: Exploring Minecraft modding patterns
- **Code search**: Finding specific implementations across mod codebases

