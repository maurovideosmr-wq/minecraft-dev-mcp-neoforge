<div align="center">

# Minecraft Dev MCP

**A Model Context Protocol server that gives AI assistants native access to Minecraft mod development tools — decompile, remap, search, and analyze Minecraft source code directly from your AI workflow.**

![License](https://img.shields.io/badge/License-MIT-yellow?style=flat) ![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7.2-3178c6?style=flat) ![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.0.4-purple?style=flat) ![Java](https://img.shields.io/badge/Java-17%2B-f97316?style=flat) ![Vitest](https://img.shields.io/badge/Vitest-2.1.8-729B1B?style=flat) ![Biome](https://img.shields.io/badge/Biome-1.9.4-60a5fa?style=flat) ![WSL](https://img.shields.io/badge/WSL-Compatible-0078d4?style=flat)

**24 tools** spanning decompilation, mapping translation, mod analysis, mixin validation, NeoForge API search, access transformers, version comparison, and full-text search — with full WSL and Windows path support.

</div>

### About this repository

| | |
| --- | --- |
| **This fork** | [maurovideosmr-wq/minecraft-dev-mcp-neoforge](https://github.com/maurovideosmr-wq/minecraft-dev-mcp-neoforge) — extends upstream with **NeoForge-first** workflows (mojmap defaults, AT validation, `decompile_neoforge_api` / index / search, docs via `modLoader: neoforge`). |
| **Upstream** | [MCDxAI/minecraft-dev-mcp](https://github.com/MCDxAI/minecraft-dev-mcp) — pull updates: `git fetch upstream && git merge upstream/main` |

---

<div align="center">

## Capabilities

| Feature | Description |
| --- | --- |
| **Automatic Decompilation** | Download, remap, and decompile any Minecraft version (1.14+) on-demand with persistent smart caching |
| **Multiple Mapping Systems** | Full support for Yarn, Mojmap (official), Intermediary, and obfuscated (official) namespaces |
| **Source Code Access** | Retrieve decompiled Java source for any Minecraft class with optional line-range filtering |
| **Registry Data** | Extract block, item, entity, and other game registry data from any supported version |
| **Mod JAR Analysis** | Analyze Fabric, Quilt, Forge, and NeoForge mods — metadata, mixins, dependencies, entry points, class statistics |
| **Mod Decompilation** | Decompile third-party mod JARs to readable Java source with full regex and FTS5 search support |
| **Mixin Validation** | Parse and validate Mixin annotations against Minecraft source — validates targets, injection points, and suggests fixes |
| **Access Widener Validation** | Validate `.accesswidener` files against decompiled source with error reporting and similarity suggestions |
| **Version Comparison** | Class-level and AST-level diff analysis between Minecraft versions — method signatures, field changes, breaking changes |
| **Full-Text Search** | SQLite FTS5 indexes for fast searching across Minecraft and mod source with BM25 ranking |
| **Mapping Translation** | Translate any symbol between official, intermediary, Yarn, and Mojmap namespaces |
| **Unobfuscated Version Support** | Native support for Minecraft 26.1+ which ships with deobfuscated class names |
| **NeoForge** | `decompile_neoforge_api` + FTS index/search on NeoForged JAR; `validate_access_transformer` for AT files; mod tools default to **mojmap** when `modLoader: neoforge` |
| **WSL Compatibility** | Accepts both WSL (`/mnt/c/...`) and Windows (`C:\...`) paths throughout all tools |

</div>

---

<div align="center">

## Prerequisites

| Requirement | Details |
| --- | --- |
| **Node.js 18+** | [nodejs.org](https://nodejs.org/) |
| **Java 17+** | Required for decompilation and remapping • Verify with `java -version` • [Adoptium](https://adoptium.net/) or [Oracle JDK](https://www.oracle.com/java/technologies/downloads/) |

</div>

---

<div align="center">

## Installation

| Method | Command |
| --- | --- |
| **NPM (Recommended)** | `npm install -g @mcdxai/minecraft-dev-mcp` |
| **NPX (No Install)** | Use `npx -y @mcdxai/minecraft-dev-mcp` directly in config |
| **From Source** | See the [Development](#development) section |

</div>

---

<div align="center">

## Quick Start

### Claude Desktop

Add to your Claude Desktop configuration file:

| Platform | Config Path |
| --- | --- |
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Linux** | `~/.config/Claude/claude_desktop_config.json` |

</div>

**NPM installation:**

```json
{
  "mcpServers": {
    "minecraft-dev": {
      "command": "minecraft-dev-mcp"
    }
  }
}
```

**NPX (no installation required):**

```json
{
  "mcpServers": {
    "minecraft-dev": {
      "command": "npx",
      "args": ["-y", "@mcdxai/minecraft-dev-mcp"]
    }
  }
}
```

<div align="center">

### Claude Code

Add to `.claude/settings.local.json` in your project, or to your global Claude Code settings:

</div>

```json
{
  "mcpServers": {
    "minecraft-dev": {
      "command": "minecraft-dev-mcp"
    }
  }
}
```

---

<div align="center">

## Tools Reference

24 tools organized by functionality.

### Source Code (6 tools)

Decompile, browse, and search Minecraft source code.

| Tool | Description | Parameters |
| --- | --- | --- |
| **list_minecraft_versions** | List all versions available from Mojang and which are already cached locally. | None |
| **decompile_minecraft_version** | Decompile an entire Minecraft version. Downloads the client JAR, remaps it, and decompiles all classes with VineFlower. Subsequent calls use cached results. | `version`, `mapping` • Optional: `force` (re-decompile) |
| **get_minecraft_source** | Get decompiled Java source for a specific Minecraft class. Downloads, remaps, and decompiles automatically on first use; subsequent requests are instant from cache. | `version`, `className`, `mapping` (`yarn`\|`mojmap`) • Optional: `startLine`, `endLine`, `maxLines` |
| **search_minecraft_code** | Regex search across decompiled Minecraft source by class name, method name, field name, or file content. | `version`, `query`, `searchType` (`class`\|`method`\|`field`\|`content`\|`all`), `mapping` • Optional: `limit` |
| **index_minecraft_version** | Build a SQLite FTS5 full-text search index for decompiled Minecraft source. Required before using `search_indexed`. | `version`, `mapping` |
| **search_indexed** | Fast full-text search on a pre-built index using FTS5 syntax. Significantly faster than `search_minecraft_code` for broad queries. Supports AND, OR, NOT, phrase matching, and prefix wildcards. | `query`, `version`, `mapping` • Optional: `types` (`class`\|`method`\|`field`), `limit` |

### Mappings & Registry (3 tools)

Translate names between namespaces and explore game data.

| Tool | Description | Parameters |
| --- | --- | --- |
| **find_mapping** | Translate a class, method, or field name between any two mapping namespaces (official, intermediary, yarn, mojmap). | `symbol`, `version`, `sourceMapping`, `targetMapping` |
| **remap_mod_jar** | Remap a **Fabric** mod JAR (intermediary → yarn/mojmap). **Not** for NeoForge MDK builds — pass `modLoader: neoforge` for an explicit error and guidance. | `inputJar`, `outputJar`, `toMapping` • Optional: `mcVersion`, `modLoader` |
| **get_registry_data** | Extract registry data (blocks, items, entities, etc.) for a version by running Minecraft's built-in data generator. | `version` • Optional: `registry` (e.g., `block`, `item`, `entity`) |

### Analysis & Validation (6 tools)

Compare versions, validate mod code, and browse documentation.

| Tool | Description | Parameters |
| --- | --- | --- |
| **compare_versions** | Compare two Minecraft versions to identify added and removed classes and registry entries. | `fromVersion`, `toVersion`, `mapping` • Optional: `category` (`classes`\|`registry`\|`all`) |
| **compare_versions_detailed** | AST-level version comparison showing exact method signature changes, field type changes, and breaking API modifications. Can be scoped to specific packages. | `fromVersion`, `toVersion`, `mapping` • Optional: `packages`, `maxClasses` |
| **analyze_mixin** | Parse and validate Mixin code against Minecraft source. JARs: reads Fabric `fabric.mod.json` and Forge/Neo `mods.toml` / `neoforge.mods.toml` for mixin configs. | `source`, `mcVersion` • Optional: `mapping`, `modLoader` (`fabric` → yarn default, `neoforge` → mojmap) |
| **validate_access_widener** | Validate a **Fabric** Access Widener file. For NeoForge, use `validate_access_transformer`; `modLoader: neoforge` returns a short pointer. | `content`, `mcVersion` • Optional: `mapping`, `modLoader` |
| **validate_access_transformer** | Parse and validate **Forge/NeoForge** Access Transformer (`.cfg`) lines against decompiled mojmap (or yarn) sources. | `content`, `mcVersion` • Optional: `mapping` |
| **get_documentation** | Class/concept docs: `modLoader: fabric` (Fabric Wiki) or `neoforge` (docs.neoforged.net). Never mix both in one call. | `className` • Optional: `modLoader`, `mcVersion` (NeoForged path hint) |
| **search_documentation** | Search modding documentation for one stack only (`fabric` or `neoforge`). | `query` • Optional: `modLoader`, `mcVersion` |

### Mod Analysis (5 tools)

Analyze and decompile third-party mod JARs.

| Tool | Description | Parameters |
| --- | --- | --- |
| **analyze_mod_jar** | Analyze a third-party mod JAR without decompiling. Extracts mod ID, version, dependencies, entry points, mixin configs, and class statistics. Supports Fabric, Quilt, Forge, and NeoForge. | `jarPath` • Optional: `includeAllClasses`, `includeRawMetadata` |
| **decompile_mod_jar** | Decompile a mod JAR to readable source. **NeoForge:** default `mapping` is **mojmap** when `modLoader: neoforge`. | `jarPath` • Optional: `mapping`, `modLoader`, `modId`, `modVersion` |
| **search_mod_code** | Regex search in decompiled mod source. | `modId`, `modVersion`, `query`, `searchType` • Optional: `mapping`, `modLoader`, `limit` |
| **index_mod** | SQLite FTS5 index for decompiled mod source. | `modId`, `modVersion` • Optional: `mapping`, `modLoader`, `force` |
| **search_mod_indexed** | FTS5 search on a mod index. | `query`, `modId`, `modVersion` • Optional: `mapping`, `modLoader`, `types`, `limit` |
| **decompile_neoforge_api** | Download NeoForge **universal** JAR from NeoForged Maven and decompile to Java (API reference). | `mcVersion` • Optional: `neoForgeVersion`, `force` |
| **index_neoforge_api** | Build FTS5 index for decompiled NeoForge API (requires decompile or existing tree). | `mcVersion` • Optional: `neoForgeVersion`, `force` |
| **search_neoforge_api** | Search indexed NeoForge API sources. | `query`, `mcVersion` • Optional: `neoForgeVersion`, `types`, `limit` |

</div>

---

<div align="center">

## Common Workflows

| Workflow | Steps |
| --- | --- |
| **First-time source access** | Call `get_minecraft_source` → server downloads client JAR (~50 MB), mappings (~5 MB), remaps (~2 min), decompiles with VineFlower (~3 min), returns source. Total: ~5 min first run. Subsequent requests for any class from the same version return in ~50ms from cache. |
| **Analyze a third-party mod** | 1. `analyze_mod_jar` (no decompilation needed, returns metadata instantly) → 2. `remap_mod_jar` to translate from intermediary → 3. `decompile_mod_jar` → 4. `search_mod_code` or `index_mod` + `search_mod_indexed` |
| **Validate a Fabric mixin** | `analyze_mixin` with your Java source or JAR path — validates target classes, method selectors, and injection types against the decompiled MC version. Returns errors and name suggestions. |
| **Find breaking changes between versions** | `compare_versions` for a high-level class and registry overview, then `compare_versions_detailed` scoped to specific packages for full AST-level method and field diffs. |
| **Fast broad code search** | `index_minecraft_version` once per version/mapping combination, then `search_indexed` with FTS5 queries: `entity AND damage`, `"onBlockBreak"`, `tick*`, `BlockEntity NOT render`. |
| **Translate obfuscated names** | `find_mapping` with `sourceMapping: "official"` and your obfuscated symbol to look up the equivalent Yarn or Mojmap name. Supports class, method, and field lookups. |
| **NeoForge mod + API** | Use `modLoader: neoforge` and **mojmap** on mod tools. Vanilla: `decompile_minecraft_version` with `mojmap`. API: `decompile_neoforge_api` → `index_neoforge_api` → `search_neoforge_api`. AT files: `validate_access_transformer`. |

</div>

---

<div align="center">

## Architecture

### Technology Stack

| Component | Technology |
| --- | --- |
| **MCP SDK** | [@modelcontextprotocol/sdk 1.0.4](https://github.com/modelcontextprotocol/typescript-sdk) |
| **Decompiler** | [VineFlower 1.11.2](https://github.com/Vineflower/vineflower) — modern Java 17+ decompiler with generics support |
| **Remapper** | [tiny-remapper 0.10.3](https://github.com/FabricMC/tiny-remapper) — FabricMC's multi-threaded bytecode remapper |
| **Yarn Mappings** | [FabricMC Yarn](https://fabricmc.net/wiki/documentation:yarn) — community-maintained mappings |
| **Mojmap** | Official Mojang mappings (available 1.14.4+) |
| **Database** | [better-sqlite3 11.7.0](https://github.com/WiseLibs/better-sqlite3) — metadata caching and FTS5 full-text indexing |
| **JAR Parsing** | [adm-zip 0.5.16](https://github.com/cthackers/adm-zip) — mod JAR analysis and bytecode scanning |
| **Schema Validation** | [Zod 3.24.1](https://github.com/colinhacks/zod) — runtime validation for all tool inputs |
| **Language** | TypeScript 5.7.2, ESM-only (`"type": "module"`) |
| **Linter** | Biome 1.9.4 |
| **Tests** | Vitest 2.1.8 — `npm test` (fast, offline-friendly) · `npm run test:integration` (full downloads) |

### Remapping Strategy

Yarn mappings require a two-step remapping process due to how FabricMC's mapping system is structured:

| Step | From | To | Mapping File |
| --- | --- | --- | --- |
| **1** | Official (obfuscated) | Intermediary | `intermediary.tiny` |
| **2** | Intermediary | Named (Yarn or Mojmap) | `yarn.tiny` or `mojmap.tiny` |

Intermediary provides stable, version-independent identifiers that bridge between obfuscated official names and human-readable Yarn/Mojmap names.

### Cache Structure

| Platform | Cache Directory |
| --- | --- |
| **Windows** | `%APPDATA%\minecraft-dev-mcp\` |
| **macOS** | `~/Library/Application Support/minecraft-dev-mcp/` |
| **Linux** | `~/.config/minecraft-dev-mcp/` |

| Path | Contents |
| --- | --- |
| `jars/` | Downloaded Minecraft client and server JARs |
| `mappings/` | Yarn, Mojmap, and Intermediary mapping files in Tiny v2 format |
| `remapped/` | Remapped JARs (obfuscated → named) |
| `decompiled/{version}/{mapping}/` | Decompiled Minecraft Java source files |
| `decompiled-mods/{modId}/{modVersion}/{mapping}/` | Decompiled mod source files |
| `registry/{version}/` | Registry data extracted by Minecraft's data generator |
| `resources/` | VineFlower and tiny-remapper JARs (downloaded once) |
| `search_index.db` | SQLite FTS5 indexes for Minecraft, mod, and NeoForge API source |
| `decompiled-neoforge/{mc}/{neoVersion}/` | Decompiled NeoForge universal API (VineFlower) |
| `neoforge/jars/` | Cached NeoForge universal JARs |
| `minecraft-dev-mcp.db` | Metadata, job tracking, and cache state |
| `minecraft-dev-mcp.log` | Server log file |

| Component | Approximate Size |
| --- | --- |
| **Per Minecraft version** | ~400–500 MB (JAR + mappings + remapped JAR + decompiled source) |
| **Per search index** | ~50–100 MB (SQLite FTS5, created on-demand) |
| **Decompiler tools** | ~1 MB (VineFlower + tiny-remapper, one-time download) |

</div>

---

<div align="center">

## Version Support

| Version Range | Yarn | Mojmap | Notes |
| --- | --- | --- | --- |
| **1.14 – 1.21.11** | Full support | Full support | Obfuscated — two-step remapping required (official → intermediary → named) |
| **26.1+** | Not available | Full support | Deobfuscated by Mojang — no remapping needed, classes already human-readable |

Yarn mappings are discontinued after 1.21.11, which is the last obfuscated Minecraft version. All 26.1+ releases ship with readable class and method names and only require Mojmap.

**Tested versions:** 1.19.4 · 1.20.1 · 1.21.10 · 1.21.11 · 26.1-snapshot-8 · 26.1-snapshot-9

</div>

---

<div align="center">

## Configuration

| Environment Variable | Description |
| --- | --- |
| `CACHE_DIR` | Override the default cache directory location |
| `LOG_LEVEL` | Logging verbosity: `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `NEOFORGE_DOCS_VERSION` | Force NeoForged docs path segment (e.g. `1.21.1`) for `get_documentation` / `search_documentation` when `modLoader: neoforge` |

</div>

```json
{
  "mcpServers": {
    "minecraft-dev": {
      "command": "minecraft-dev-mcp",
      "env": {
        "CACHE_DIR": "/custom/cache/path",
        "LOG_LEVEL": "DEBUG"
      }
    }
  }
}
```

---

<div align="center">

## Development

| Task | Command |
| --- | --- |
| **Install dependencies** | `npm install` |
| **Build** | `npm run build` |
| **Dev mode (hot reload)** | `npm run dev` |
| **Type check** | `npm run typecheck` |
| **Lint** | `npm run lint` |
| **Lint with autofix** | `npm run lint:fix` |
| **Default tests (fast, offline-friendly)** | `npm test` |
| **Full integration tests (downloads JARs/mappings)** | `npm run test:integration` |
| **Full pipeline — 1.21.10** | `npm run test:manual:1.21.10` |
| **Full pipeline — 1.20.1** | `npm run test:manual:1.20.1` |
| **MCP stdio tests** | `npm run test:manual:mcp` |
| **MCP Inspector** | `npm run inspect` |

</div>

**Build from source:**

```bash
# This fork (NeoForge-oriented additions)
git clone https://github.com/maurovideosmr-wq/minecraft-dev-mcp-neoforge.git
cd minecraft-dev-mcp-neoforge
npm install
npm run build
```

Upstream clone (for comparison): `https://github.com/MCDxAI/minecraft-dev-mcp.git` — add as `git remote add upstream <url>` to merge updates.

---

<div align="center">

## Troubleshooting

| Issue | Solution |
| --- | --- |
| **Java not found** — `Java 17+ is required but not found` | Install Java 17+ from [Adoptium](https://adoptium.net/) • Verify with `java -version` • Ensure `java` is on your PATH |
| **Decompilation fails** | Check available disk space (~500 MB per version) • Review `%APPDATA%\minecraft-dev-mcp\minecraft-dev-mcp.log` • Force re-decompile by passing `"force": true` |
| **Yarn not available** — `Yarn mappings not available for version X` | Yarn is only supported for 1.14–1.21.11 • Use `mojmap` for 26.1+ versions |
| **Class not found** | Use the fully qualified class name (e.g., `net.minecraft.world.entity.Entity`) • Verify the version is decompiled |
| **Registry returns no data** | Registry names use singular form: `block`, `item`, `entity` — not `blocks`, `items`, `entities` |
| **WSL path error** | Both `/mnt/c/path/to/file` and `C:\path\to\file` are accepted for all JAR path parameters |

</div>

---

<div align="center">

## Credits

| Project | Details |
| --- | --- |
| **VineFlower** | Modern Java decompiler by the [Vineflower Team](https://github.com/Vineflower/vineflower) |
| **tiny-remapper** | JAR remapping tool by [FabricMC](https://github.com/FabricMC) |
| **Yarn Mappings** | Community-maintained mappings by [FabricMC](https://fabricmc.net/) |
| **MCP SDK** | Protocol implementation by [Anthropic](https://github.com/modelcontextprotocol/typescript-sdk) |

**Built for the Minecraft modding community**

</div>
