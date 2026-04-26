/**
 * Documentation Integration Service
 *
 * Provides documentation from multiple sources for Minecraft classes and methods:
 * - Fabric Wiki
 * - NeoForged (docs for MC 1.21.1 — parallel to Fabric, additive)
 * - Minecraft Wiki (for game concepts)
 * - Parchment parameter names and javadocs
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DocumentationEntry } from '../types/minecraft.js';
import { logger } from '../utils/logger.js';
import { getCacheDir } from '../utils/paths.js';

/** Which modding stack docs to return — never both in one response. */
export type ModDocLoader = 'fabric' | 'neoforge';

/**
 * NeoForged docs path segment for docs.neoforged.net/docs/{version}/…
 * Priority: `NEOFORGE_DOCS_VERSION` env → Minecraft version mapping → default 1.21.1.
 */
export function resolveNeoforgedDocsVersion(mcVersion?: string): string {
  const env = process.env.NEOFORGE_DOCS_VERSION?.trim();
  if (env) {
    return env;
  }
  const v = mcVersion?.trim();
  if (v) {
    /**
     * Maps Minecraft versions to the docs path segment on docs.neoforged.net (e.g. `1.21.4` →
     * `https://docs.neoforged.net/docs/1.21.4/...`). When NeoForged publishes a new docs tree for
     * an MC release, add the pair here. Alternatively set `NEOFORGE_DOCS_VERSION` in the
     * environment to force a version without code changes.
     */
    const MC_TO_DOCS: Record<string, string> = {
      '1.21.1': '1.21.1',
      '1.21.4': '1.21.4',
      '1.21.5': '1.21.5',
      '1.20.1': '1.20.1',
      '1.20.4': '1.20.4',
      '1.21': '1.21.1',
      '1.20': '1.20.1',
    };
    if (MC_TO_DOCS[v]) {
      return MC_TO_DOCS[v];
    }
    const triplet = v.match(/^(\d+\.\d+\.\d+)/);
    if (triplet?.[1] && MC_TO_DOCS[triplet[1]]) {
      return MC_TO_DOCS[triplet[1]];
    }
    return triplet?.[1] ?? v;
  }
  return '1.21.1';
}

/** Same as {@link resolveNeoforgedDocsVersion}() without an MC version hint. */
export function getNeoforgedDocsVersion(): string {
  return resolveNeoforgedDocsVersion();
}

export function buildNeoforgedDocsUrl(docsVersion: string, relPath: string): string {
  const p = relPath.startsWith('/') ? relPath : `/${relPath}`;
  return `https://docs.neoforged.net/docs/${docsVersion}${p}`;
}

/**
 * Documentation cache entry
 */
interface DocCache {
  [key: string]: {
    entry: DocumentationEntry;
    cachedAt: number;
  };
}

/**
 * Known documentation mappings for common Minecraft classes
 */
const KNOWN_DOCS: Record<string, Partial<DocumentationEntry>> = {
  'net.minecraft.entity.Entity': {
    summary: 'Base class for all entities in Minecraft',
    url: 'https://fabricmc.net/wiki/tutorial:entity',
  },
  'net.minecraft.entity.LivingEntity': {
    summary: 'Base class for all living entities (mobs, players)',
    url: 'https://fabricmc.net/wiki/tutorial:entity',
  },
  'net.minecraft.entity.player.PlayerEntity': {
    summary: 'Represents a player in the game world',
    url: 'https://fabricmc.net/wiki/tutorial:entity',
  },
  'net.minecraft.block.Block': {
    summary: 'Base class for all blocks in the world',
    url: 'https://fabricmc.net/wiki/tutorial:blocks',
  },
  'net.minecraft.block.BlockState': {
    summary: 'Immutable snapshot of a block with its properties',
    url: 'https://fabricmc.net/wiki/tutorial:blockstate',
  },
  'net.minecraft.item.Item': {
    summary: 'Base class for all items in the game',
    url: 'https://fabricmc.net/wiki/tutorial:items',
  },
  'net.minecraft.item.ItemStack': {
    summary: 'Represents a stack of items with count and NBT data',
    url: 'https://fabricmc.net/wiki/tutorial:items',
  },
  'net.minecraft.world.World': {
    summary: 'Represents a game world/dimension',
    url: 'https://fabricmc.net/wiki/tutorial:world',
  },
  'net.minecraft.server.world.ServerWorld': {
    summary: 'Server-side world implementation',
    url: 'https://fabricmc.net/wiki/tutorial:world',
  },
  'net.minecraft.client.world.ClientWorld': {
    summary: 'Client-side world implementation',
    url: 'https://fabricmc.net/wiki/tutorial:world',
  },
  'net.minecraft.nbt.NbtCompound': {
    summary: 'Named Binary Tag compound for data serialization',
    url: 'https://fabricmc.net/wiki/tutorial:nbt',
  },
  'net.minecraft.util.Identifier': {
    summary: 'Namespaced identifier (e.g., minecraft:stone)',
    url: 'https://fabricmc.net/wiki/tutorial:identifiers',
  },
  'net.minecraft.util.math.BlockPos': {
    summary: 'Immutable integer position in the world',
    url: 'https://fabricmc.net/wiki/tutorial:blockpos',
  },
  'net.minecraft.util.math.Vec3d': {
    summary: 'Double-precision 3D vector',
    url: 'https://fabricmc.net/wiki/tutorial:vectors',
  },
  'net.minecraft.text.Text': {
    summary: 'Rich text component for chat and UI',
    url: 'https://fabricmc.net/wiki/tutorial:text',
  },
  'net.minecraft.screen.ScreenHandler': {
    summary: 'Manages inventory screen logic (like container)',
    url: 'https://fabricmc.net/wiki/tutorial:screenhandler',
  },
  'net.minecraft.recipe.Recipe': {
    summary: 'Base interface for crafting recipes',
    url: 'https://fabricmc.net/wiki/tutorial:recipes',
  },
  'net.minecraft.registry.Registry': {
    summary: 'Game registry for blocks, items, entities, etc.',
    url: 'https://fabricmc.net/wiki/tutorial:registry',
  },
  'net.minecraft.sound.SoundEvent': {
    summary: 'Represents a sound that can be played',
    url: 'https://fabricmc.net/wiki/tutorial:sounds',
  },
  'net.minecraft.particle.ParticleEffect': {
    summary: 'Particle effect that can be spawned',
    url: 'https://fabricmc.net/wiki/tutorial:particles',
  },
};

/**
 * Fabric Wiki page mappings
 */
const FABRIC_WIKI_PAGES: Record<string, string> = {
  entity: 'https://fabricmc.net/wiki/tutorial:entity',
  block: 'https://fabricmc.net/wiki/tutorial:blocks',
  item: 'https://fabricmc.net/wiki/tutorial:items',
  world: 'https://fabricmc.net/wiki/tutorial:world',
  recipe: 'https://fabricmc.net/wiki/tutorial:recipes',
  mixin: 'https://fabricmc.net/wiki/tutorial:mixin_introduction',
  accesswidener: 'https://fabricmc.net/wiki/tutorial:accesswideners',
  registry: 'https://fabricmc.net/wiki/tutorial:registry',
  networking: 'https://fabricmc.net/wiki/tutorial:networking',
  commands: 'https://fabricmc.net/wiki/tutorial:commands',
  events: 'https://fabricmc.net/wiki/tutorial:events',
  rendering: 'https://fabricmc.net/wiki/tutorial:rendering',
  blockentity: 'https://fabricmc.net/wiki/tutorial:blockentity',
  screenhandler: 'https://fabricmc.net/wiki/tutorial:screenhandler',
  datagen: 'https://fabricmc.net/wiki/tutorial:datagen',
};

/**
 * Same topic keys as {@link FABRIC_WIKI_PAGES} where possible — paths only; pair with {@link buildNeoforgedDocsUrl}.
 */
const NEOFORGED_WIKI_REL: Record<string, string> = {
  entity: '/concepts/registries',
  block: '/blocks/',
  item: '/items/',
  world: '/resources/',
  recipe: '/resources/server/recipes/',
  mixin: '/gettingstarted/',
  accesswidener: '/gettingstarted/',
  registry: '/concepts/registries',
  networking: '/networking/',
  commands: '/resources/',
  events: '/concepts/events',
  rendering: '/resources/client/models/',
  blockentity: '/blockentities/',
  screenhandler: '/items/',
  datagen: '/resources/',
};

/** NeoForged path for each {@link KNOWN_DOCS} class (same class names as obfuscated/official code). */
const NEOFORGED_KNOWN_DOCS_REL: Record<string, string> = {
  'net.minecraft.entity.Entity': '/concepts/registries',
  'net.minecraft.entity.LivingEntity': '/concepts/registries',
  'net.minecraft.entity.player.PlayerEntity': '/concepts/registries',
  'net.minecraft.block.Block': '/blocks/',
  'net.minecraft.block.BlockState': '/blocks/states',
  'net.minecraft.item.Item': '/items/',
  'net.minecraft.item.ItemStack': '/items/',
  'net.minecraft.world.World': '/resources/',
  'net.minecraft.server.world.ServerWorld': '/resources/',
  'net.minecraft.client.world.ClientWorld': '/resources/',
  'net.minecraft.nbt.NbtCompound': '/datastorage/nbt',
  'net.minecraft.util.Identifier': '/misc/resourcelocation',
  'net.minecraft.util.math.BlockPos': '/blocks/',
  'net.minecraft.util.math.Vec3d': '/blocks/',
  'net.minecraft.text.Text': '/resources/',
  'net.minecraft.screen.ScreenHandler': '/items/',
  'net.minecraft.recipe.Recipe': '/resources/server/recipes/',
  'net.minecraft.registry.Registry': '/concepts/registries',
  'net.minecraft.sound.SoundEvent': '/resources/',
  'net.minecraft.particle.ParticleEffect': '/resources/',
};

/**
 * Documentation Integration Service
 */
export class DocumentationService {
  private cache: DocCache = {};
  private cacheDir: string;
  private cacheFile: string;
  private cacheTTL = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.cacheDir = join(getCacheDir(), 'docs');
    this.cacheFile = join(this.cacheDir, 'doc_cache.json');
    this.loadCache();
  }

  /**
   * Load cache from disk
   */
  private loadCache(): void {
    try {
      if (existsSync(this.cacheFile)) {
        const content = readFileSync(this.cacheFile, 'utf8');
        this.cache = JSON.parse(content);
      }
    } catch (error) {
      logger.warn('Failed to load documentation cache:', error);
      this.cache = {};
    }
  }

  /**
   * Save cache to disk
   */
  private saveCache(): void {
    try {
      if (!existsSync(this.cacheDir)) {
        mkdirSync(this.cacheDir, { recursive: true });
      }
      writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2));
    } catch (error) {
      logger.warn('Failed to save documentation cache:', error);
    }
  }

  private static docKey(d: DocumentationEntry): string {
    return `${d.source}::${d.url}`;
  }

  private pushIfNew(list: DocumentationEntry[], item: DocumentationEntry): boolean {
    if (list.some((x) => DocumentationService.docKey(x) === DocumentationService.docKey(item))) {
      return false;
    }
    list.push(item);
    return true;
  }

  /**
   * NeoForged doc link for a class (use with modLoader === 'neoforge' only).
   */
  getNeoforgedDocumentationForClass(className: string, mcVersion?: string): DocumentationEntry | null {
    const dv = resolveNeoforgedDocsVersion(mcVersion);
    const rel = NEOFORGED_KNOWN_DOCS_REL[className];
    if (rel) {
      return {
        name: className,
        source: 'neoforged_docs',
        url: buildNeoforgedDocsUrl(dv, rel),
        summary: KNOWN_DOCS[className]?.summary || `NeoForged ${dv} reference`,
      };
    }
    return this.inferNeoforgedDocumentation(className, dv);
  }

  /**
   * NeoForged topic page (mirrors {@link getTopicDocumentation} keys).
   */
  getNeoforgedTopicDocumentation(topic: string, mcVersion?: string): DocumentationEntry | null {
    const dv = resolveNeoforgedDocsVersion(mcVersion);
    const topicLower = topic.toLowerCase();
    const rel = NEOFORGED_WIKI_REL[topicLower];
    if (rel) {
      return {
        name: `neoforged/${topicLower}`,
        source: 'neoforged_docs',
        url: buildNeoforgedDocsUrl(dv, rel),
        summary: `NeoForged ${dv} — ${topic} topic`,
      };
    }
    for (const [key, path] of Object.entries(NEOFORGED_WIKI_REL)) {
      if (key.includes(topicLower) || topicLower.includes(key)) {
        return {
          name: `neoforged/${key}`,
          source: 'neoforged_docs',
          url: buildNeoforgedDocsUrl(dv, path),
          summary: `NeoForged ${dv} — ${key} topic`,
        };
      }
    }
    return null;
  }

  private inferNeoforgedDocumentation(className: string, dv: string): DocumentationEntry | null {
    const simpleName = className.split('.').pop() || className;
    const toNf = (k: keyof typeof NEOFORGED_WIKI_REL) =>
      this.topicEntryNeoforged(k, className, simpleName, dv);

    if (className.includes('.entity.') || simpleName.endsWith('Entity')) {
      return toNf('entity');
    }
    if (className.includes('.block.') || simpleName.endsWith('Block')) {
      return toNf('block');
    }
    if (className.includes('.item.') || simpleName.endsWith('Item')) {
      return toNf('item');
    }
    if (
      className.includes('.screen.') ||
      simpleName.endsWith('Screen') ||
      simpleName.endsWith('Handler')
    ) {
      return toNf('screenhandler');
    }
    if (className.includes('.recipe.') || simpleName.endsWith('Recipe')) {
      return toNf('recipe');
    }
    if (
      className.includes('.network.') ||
      simpleName.endsWith('Packet') ||
      simpleName.endsWith('S2CPacket') ||
      simpleName.endsWith('C2SPacket')
    ) {
      return toNf('networking');
    }
    if (className.includes('.command.') || simpleName.endsWith('Command')) {
      return toNf('commands');
    }
    if (
      className.includes('.render.') ||
      simpleName.endsWith('Renderer') ||
      simpleName.endsWith('Model')
    ) {
      return toNf('rendering');
    }
    if (className.includes('.registry.') || simpleName.includes('Registry')) {
      return toNf('registry');
    }
    if (simpleName.endsWith('BlockEntity')) {
      return toNf('blockentity');
    }

    return null;
  }

  private topicEntryNeoforged(
    topic: keyof typeof NEOFORGED_WIKI_REL,
    className: string,
    simpleName: string,
    dv: string,
  ): DocumentationEntry {
    const category =
      topic === 'blockentity'
        ? 'block entity'
        : topic === 'screenhandler'
          ? 'screen/GUI'
          : String(topic);
    return {
      name: className,
      source: 'neoforged_docs',
      url: buildNeoforgedDocsUrl(dv, NEOFORGED_WIKI_REL[topic]),
      summary: `${this.generateSummary(simpleName, category)} (NeoForged ${dv})`,
    };
  }

  /**
   * Get documentation for a class
   */
  async getDocumentation(className: string): Promise<DocumentationEntry | null> {
    // Check cache
    const cached = this.cache[className];
    if (cached && Date.now() - cached.cachedAt < this.cacheTTL) {
      return cached.entry;
    }

    // Check known docs
    if (KNOWN_DOCS[className]) {
      const entry: DocumentationEntry = {
        name: className,
        source: 'fabric_wiki',
        summary: KNOWN_DOCS[className].summary || '',
        url: KNOWN_DOCS[className].url || '',
        ...KNOWN_DOCS[className],
      };

      this.cache[className] = { entry, cachedAt: Date.now() };
      this.saveCache();
      return entry;
    }

    // Try to infer documentation from class name
    const inferred = this.inferDocumentation(className);
    if (inferred) {
      this.cache[className] = { entry: inferred, cachedAt: Date.now() };
      this.saveCache();
      return inferred;
    }

    return null;
  }

  /**
   * Infer documentation based on class name patterns
   */
  private inferDocumentation(className: string): DocumentationEntry | null {
    const simpleName = className.split('.').pop() || className;

    // Entity classes
    if (className.includes('.entity.') || simpleName.endsWith('Entity')) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.entity,
        summary: this.generateSummary(simpleName, 'entity'),
        seeAlso: ['net.minecraft.entity.Entity', 'net.minecraft.entity.LivingEntity'],
      };
    }

    // Block classes
    if (className.includes('.block.') || simpleName.endsWith('Block')) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.block,
        summary: this.generateSummary(simpleName, 'block'),
        seeAlso: ['net.minecraft.block.Block', 'net.minecraft.block.BlockState'],
      };
    }

    // Item classes
    if (className.includes('.item.') || simpleName.endsWith('Item')) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.item,
        summary: this.generateSummary(simpleName, 'item'),
        seeAlso: ['net.minecraft.item.Item', 'net.minecraft.item.ItemStack'],
      };
    }

    // Screen/GUI classes
    if (
      className.includes('.screen.') ||
      simpleName.endsWith('Screen') ||
      simpleName.endsWith('Handler')
    ) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.screenhandler,
        summary: this.generateSummary(simpleName, 'screen/GUI'),
        seeAlso: ['net.minecraft.screen.ScreenHandler'],
      };
    }

    // Recipe classes
    if (className.includes('.recipe.') || simpleName.endsWith('Recipe')) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.recipe,
        summary: this.generateSummary(simpleName, 'recipe'),
        seeAlso: ['net.minecraft.recipe.Recipe'],
      };
    }

    // Network/packet classes
    if (
      className.includes('.network.') ||
      simpleName.endsWith('Packet') ||
      simpleName.endsWith('S2CPacket') ||
      simpleName.endsWith('C2SPacket')
    ) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.networking,
        summary: this.generateSummary(simpleName, 'networking'),
      };
    }

    // Command classes
    if (className.includes('.command.') || simpleName.endsWith('Command')) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.commands,
        summary: this.generateSummary(simpleName, 'command'),
      };
    }

    // Render classes
    if (
      className.includes('.render.') ||
      simpleName.endsWith('Renderer') ||
      simpleName.endsWith('Model')
    ) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.rendering,
        summary: this.generateSummary(simpleName, 'rendering'),
      };
    }

    // Registry classes
    if (className.includes('.registry.') || simpleName.includes('Registry')) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.registry,
        summary: this.generateSummary(simpleName, 'registry'),
        seeAlso: ['net.minecraft.registry.Registry'],
      };
    }

    // BlockEntity classes
    if (simpleName.endsWith('BlockEntity')) {
      return {
        name: className,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES.blockentity,
        summary: this.generateSummary(simpleName, 'block entity'),
      };
    }

    return null;
  }

  /**
   * Generate a summary based on class name
   */
  private generateSummary(simpleName: string, category: string): string {
    // Convert CamelCase to words
    const words = simpleName.replace(/([A-Z])/g, ' $1').trim();
    return `${words} - a ${category} class`;
  }

  /**
   * Get documentation for a topic
   */
  async getTopicDocumentation(topic: string): Promise<DocumentationEntry | null> {
    const topicLower = topic.toLowerCase();

    // Check if it's a known topic
    if (FABRIC_WIKI_PAGES[topicLower]) {
      return {
        name: topic,
        source: 'fabric_wiki',
        url: FABRIC_WIKI_PAGES[topicLower],
        summary: `Fabric Wiki documentation for ${topic}`,
      };
    }

    // Search for partial matches
    for (const [key, url] of Object.entries(FABRIC_WIKI_PAGES)) {
      if (key.includes(topicLower) || topicLower.includes(key)) {
        return {
          name: topic,
          source: 'fabric_wiki',
          url,
          summary: `Fabric Wiki documentation for ${key}`,
        };
      }
    }

    return null;
  }

  /**
   * Related docs for one class, **single loader only** (fabric or neoforge — not both).
   */
  async getRelatedDocumentation(
    className: string,
    modLoader: ModDocLoader = 'fabric',
    mcVersion?: string,
  ): Promise<DocumentationEntry[]> {
    if (modLoader === 'neoforge') {
      return this.getRelatedDocumentationNeoforge(className, mcVersion);
    }
    return this.getRelatedDocumentationFabric(className);
  }

  private async getRelatedDocumentationFabric(className: string): Promise<DocumentationEntry[]> {
    const results: DocumentationEntry[] = [];

    const main = await this.getDocumentation(className);
    if (main) {
      this.pushIfNew(results, main);
    }

    if (main?.seeAlso) {
      for (const related of main.seeAlso) {
        const relatedDoc = await this.getDocumentation(related);
        if (relatedDoc) {
          this.pushIfNew(results, relatedDoc);
        }
      }
    }

    const packagePath = className.split('.').slice(0, -1).join('.');
    if (packagePath.includes('entity')) {
      const entityDoc = await this.getTopicDocumentation('entity');
      if (entityDoc) {
        this.pushIfNew(results, entityDoc);
      }
    }
    if (packagePath.includes('block')) {
      const blockDoc = await this.getTopicDocumentation('block');
      if (blockDoc) {
        this.pushIfNew(results, blockDoc);
      }
    }
    if (packagePath.includes('item')) {
      const itemDoc = await this.getTopicDocumentation('item');
      if (itemDoc) {
        this.pushIfNew(results, itemDoc);
      }
    }

    return results;
  }

  private async getRelatedDocumentationNeoforge(
    className: string,
    mcVersion?: string,
  ): Promise<DocumentationEntry[]> {
    const results: DocumentationEntry[] = [];

    const neoMain = this.getNeoforgedDocumentationForClass(className, mcVersion);
    if (neoMain) {
      this.pushIfNew(results, neoMain);
    }

    const fabricForSeeAlso = await this.getDocumentation(className);
    if (fabricForSeeAlso?.seeAlso) {
      for (const related of fabricForSeeAlso.seeAlso) {
        const relatedNeo = this.getNeoforgedDocumentationForClass(related, mcVersion);
        if (relatedNeo) {
          this.pushIfNew(results, relatedNeo);
        }
      }
    }

    const packagePath = className.split('.').slice(0, -1).join('.');
    if (packagePath.includes('entity')) {
      const ne = this.getNeoforgedTopicDocumentation('entity', mcVersion);
      if (ne) {
        this.pushIfNew(results, ne);
      }
    }
    if (packagePath.includes('block')) {
      const ne = this.getNeoforgedTopicDocumentation('block', mcVersion);
      if (ne) {
        this.pushIfNew(results, ne);
      }
    }
    if (packagePath.includes('item')) {
      const ne = this.getNeoforgedTopicDocumentation('item', mcVersion);
      if (ne) {
        this.pushIfNew(results, ne);
      }
    }

    return results;
  }

  /**
   * Search documentation for **one** mod stack (fabric or neoforge), never both.
   */
  searchDocumentation(
    query: string,
    modLoader: ModDocLoader = 'fabric',
    mcVersion?: string,
  ): DocumentationEntry[] {
    if (modLoader === 'neoforge') {
      return this.searchDocumentationNeoforge(query, mcVersion);
    }
    return this.searchDocumentationFabric(query);
  }

  private searchDocumentationFabric(query: string): DocumentationEntry[] {
    const results: DocumentationEntry[] = [];
    const queryLower = query.toLowerCase();

    for (const [className, partialEntry] of Object.entries(KNOWN_DOCS)) {
      if (
        className.toLowerCase().includes(queryLower) ||
        partialEntry.summary?.toLowerCase().includes(queryLower)
      ) {
        results.push({
          name: className,
          source: 'fabric_wiki',
          url: partialEntry.url || '',
          summary: partialEntry.summary || '',
        });
      }
    }

    for (const [topic, url] of Object.entries(FABRIC_WIKI_PAGES)) {
      if (topic.includes(queryLower)) {
        this.pushIfNew(results, {
          name: topic,
          source: 'fabric_wiki',
          url,
          summary: `Fabric Wiki: ${topic}`,
        });
      }
    }

    return results;
  }

  private searchDocumentationNeoforge(query: string, mcVersion?: string): DocumentationEntry[] {
    const dv = resolveNeoforgedDocsVersion(mcVersion);
    const results: DocumentationEntry[] = [];
    const queryLower = query.toLowerCase();

    for (const [className, partialEntry] of Object.entries(KNOWN_DOCS)) {
      if (
        className.toLowerCase().includes(queryLower) ||
        partialEntry.summary?.toLowerCase().includes(queryLower)
      ) {
        const neo = this.getNeoforgedDocumentationForClass(className, mcVersion);
        if (neo) {
          this.pushIfNew(results, neo);
        }
      }
    }

    for (const [topic, rel] of Object.entries(NEOFORGED_WIKI_REL)) {
      if (topic.includes(queryLower)) {
        this.pushIfNew(results, {
          name: `neoforged/${topic}`,
          source: 'neoforged_docs',
          url: buildNeoforgedDocsUrl(dv, rel),
          summary: `NeoForged ${dv}: ${topic}`,
        });
      }
    }

    if (
      queryLower.includes('neo') ||
      queryLower.includes('neoforg') ||
      queryLower.includes('mdk') ||
      queryLower.includes('getting started')
    ) {
      this.pushIfNew(results, {
        name: 'neoforged/gettingstarted',
        source: 'neoforged_docs',
        url: buildNeoforgedDocsUrl(dv, '/gettingstarted/'),
        summary: `NeoForged ${dv} — Getting Started (MDK, Gradle, run configs)`,
      });
    }

    return results;
  }

  /**
   * Get Mixin documentation
   */
  getMixinDocumentation(): DocumentationEntry {
    return {
      name: 'Mixin',
      source: 'fabric_wiki',
      url: FABRIC_WIKI_PAGES.mixin,
      summary: 'Mixins allow mods to modify Minecraft classes at runtime',
      description: `
Mixins are a way to modify Minecraft's code without directly editing it.
Common injection types:
- @Inject: Add code at specific points
- @Redirect: Replace method calls
- @ModifyArg: Modify method arguments
- @ModifyVariable: Modify local variables
- @Shadow: Access private fields/methods
- @Accessor/@Invoker: Create getters/setters for private members
      `.trim(),
      seeAlso: ['SpongePowered Mixin', 'Access Wideners'],
    };
  }

  /**
   * NeoForge / Mixin pointer (use with resources e.g. minecraft://docs/topic/neoforge/mixin).
   */
  getNeoforgedMixinDocumentation(mcVersion?: string): DocumentationEntry {
    const dv = resolveNeoforgedDocsVersion(mcVersion);
    return {
      name: 'Mixin (NeoForge)',
      source: 'neoforged_docs',
      url: buildNeoforgedDocsUrl(dv, NEOFORGED_WIKI_REL.mixin),
      summary: `NeoForge uses Mixin; see Getting Started and mod lifecycle (NeoForged ${dv})`,
    };
  }

  /**
   * NeoForge access / visibility pointer (not Fabric Access Widener).
   */
  getNeoforgedAccessTransformerPointer(mcVersion?: string): DocumentationEntry {
    const dv = resolveNeoforgedDocsVersion(mcVersion);
    return {
      name: 'Access / visibility (NeoForge)',
      source: 'neoforged_docs',
      url: buildNeoforgedDocsUrl(dv, NEOFORGED_WIKI_REL.accesswidener),
      summary: `NeoForge uses Access Transformers (different from Fabric Access Wideners). See Getting Started and NeoForged docs (${dv})`,
    };
  }

  /**
   * Get Access Widener documentation
   */
  getAccessWidenerDocumentation(): DocumentationEntry {
    return {
      name: 'Access Widener',
      source: 'fabric_wiki',
      url: FABRIC_WIKI_PAGES.accesswidener,
      summary: 'Access Wideners change the access level of classes, methods, and fields',
      description: `
Access Wideners allow mods to:
- accessible: Make private/protected members public
- extendable: Make final classes non-final
- mutable: Make final fields non-final

Format:
accessWidener v2 named
accessible class net/minecraft/example/PrivateClass
accessible method net/minecraft/example/Class methodName (Lsome/Descriptor;)V
accessible field net/minecraft/example/Class fieldName Lsome/Type;
      `.trim(),
    };
  }

  /**
   * Clear the documentation cache
   */
  clearCache(): void {
    this.cache = {};
    this.saveCache();
  }
}

// Singleton instance
let documentationServiceInstance: DocumentationService | undefined;

export function getDocumentationService(): DocumentationService {
  if (!documentationServiceInstance) {
    documentationServiceInstance = new DocumentationService();
  }
  return documentationServiceInstance;
}
