# AGENT HANDBOOK – Minecraft Dev MCP

Reference for AI/agent operators working in this repo. Grounded in `CLAUDE.md` and current project state.

## Project Snapshot

- MCP server that lets agents decompile, remap, search, and analyze Minecraft (1.14+; obfuscated through 1.21.11).
- Phase 1 & 2 complete (core + advanced tools); 29 integration tests green as of 2025-12-06.
- **Phase 3 (mod analysis) shipped**: `analyze_mod_jar`, `decompile_mod_jar`, `search_mod_code`, `index_mod`, `search_mod_indexed` (VineFlower, cache under `decompiled-mods/{modId}/{version}/{mapping}/`). **NeoForge stack**: `modLoader` on several tools (default mapping mojmap vs yarn), `validate_access_transformer`, `decompile_neoforge_api` / `index_neoforge_api` / `search_neoforge_api` (universal JAR from NeoForged Maven, cache under `decompiled-neoforge/`), and NeoForged doc URLs via `get_documentation` / resources.
- Stack: Node 18+/ESM-only (`"type": "module"`), TS 5.7, Java 17+ (21+ for newest MC), better-sqlite3, VineFlower decompiler, tiny-remapper.

## What Agents Should Prioritize

- Keep ESM intact: no CommonJS, ensure `.js` extensions on local imports after build.
- Registry extraction must use the obfuscated **server JAR** with version-aware bundler flag; never the client JAR.
- Yarn remapping is two-step: official → intermediary → yarn; do not collapse into one pass.
- Respect cache layout in platform app data (`jars/`, `mappings/`, `remapped/`, `decompiled/{version}/{mapping}/`, `registry/{version}/`, `resources/`, `search-index/`, `cache.db`).
- VineFlower drops `libraries/`, `versions/`, `logs/` in CWD during runs; temporary and gitignored.

## Architecture Wayfinder (src/)

- `services/`: `version-manager` (JARs), `mapping-service` (Yarn/Mojmap/Intermediary), `remap-service` (two-step Yarn), `decompile-service` (VineFlower), `registry-service` (data generator on server JAR), `source-service` (pipeline orchestrator).
- `java/`: `tiny-remapper`, `vineflower`, `mc-data-gen` (bundler vs legacy invocation), `java-process` (exec wrapper).
- `downloaders/`: Mojang assets/mappings, Yarn mappings, Java tool JARs.
- `cache/`: cache manager + SQLite metadata DB.
- `utils/paths.ts`: resolves OS-specific cache roots; includes `decompiledNeoforge`, `getDecompiledNeoforgePath`, `getNeoforgeJarPath` for NeoForge API flows.
- NeoForge: `downloaders/neoforge-downloader`, `services/neoforge-decompile-service`, FTS tables in `search-index-service` (`neoforge_search_index`).

## Available MCP Tools (for LLM surfaces)

- Phase 1 core: `get_minecraft_source`, `decompile_minecraft_version`, `list_minecraft_versions`, `get_registry_data`.
- Phase 2 analysis: `remap_mod_jar`, `find_mapping`, `search_minecraft_code`, `compare_versions`, `analyze_mixin`, `validate_access_widener`, `compare_versions_detailed`, `index_minecraft_version`, `search_indexed`, `get_documentation`, `search_documentation`.
- Phase 3: `analyze_mod_jar`, `decompile_mod_jar`, `search_mod_code`, `index_mod`, `search_mod_indexed`; NeoForge API: `decompile_neoforge_api`, `index_neoforge_api`, `search_neoforge_api`. For vanilla/mixin/docs, set `modLoader` / `mapping` (NeoForge: prefer `mojmap`; Fabric: often `yarn`). `remap_mod_jar` is Fabric-style intermediary remapping; pass `modLoader: neoforge` to get a clear “not supported” and guidance.

## Critical Behaviors & Pitfalls

- **Registry paths**: MC ≥1.21 writes `reports/registries.json`; <1.21 uses `generated/reports/registries.json`. Names are singular (`block`, `item`, `entity`), auto-prefixed with `minecraft:` if absent.
- **Java invocation**: MC 1.18+ bundler needs `-DbundlerMainClass=net.minecraft.data.Main`; pre-1.18 uses `-cp` mode.
- **Performance**: first decompile downloads/remaps (~400–500 MB/version). Caching makes subsequent requests near-instant.
- **Integrity**: downloads are SHA-verified; cache rebuilds on corruption; Java processes run with timeouts and memory caps.

## Testing & Commands

- Default / fast: `npm test` (vitest quick config — no JAR/mapping downloads; OK offline).
- Full integration (downloads, decompile, registry, cached tool tests): `npm run test:integration`.
- Manual/versioned suites: `npm run test:manual` (Yarn 1.21.10/1.20.1/1.19.4), `npm run test:manual:mojmap` (+ version-specific overrides).
- Dev/build: `npm run dev` (tsx watch), `npm run build`, `npm run typecheck`, `npm run lint[:fix]`.
- Full sweep: `npm run test:all` (integration + manual).

## Active TODO / Gaps

- **NeoForge Maven Snapshots** (only if needed): `neoforge-downloader` today uses the releases layout; add snapshot base URL + resolution if users require snapshot builds.
- **NeoForged docs version**: when new MC lines ship, update `MC_TO_DOCS` in `documentation-service.ts` (or set `NEOFORGE_DOCS_VERSION`). See comment above that table.

## Quick Playbooks

- Retrieve class source: ensure version cached → `get_minecraft_source(version, className, mapping)`; triggers download/remap/decompile if missing.
- Extract registries: use `registry-service` with server JAR and version-aware path detection; fail fast on wrong registry names.
- Add new mapping type: extend `MappingType`, add downloader, wire into `mapping-service`, add tests.
- Add manual test for version: copy template under `__tests__/manual/vX.Y.Z`, add script `test:manual:X.Y.Z`.

## Support Files & References

- Primary context: `CLAUDE.md` (architecture, constraints, known issues).
- Manual test guide: `__tests__/manual/README.md`.