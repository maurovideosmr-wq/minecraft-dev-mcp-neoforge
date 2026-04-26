/**
 * Shared Mixin JSON config parsing from JAR/ZIP entries (Fabric / NeoForge / Forge).
 */

import type AdmZip from 'adm-zip';
import type { ModMixinConfig } from '../types/minecraft.js';
import { logger } from '../utils/logger.js';

export interface MixinConfigJson {
  required?: boolean;
  package?: string;
  compatibilityLevel?: string;
  mixins?: string[];
  client?: string[];
  server?: string[];
  injectors?: {
    defaultRequire?: number;
  };
  refmap?: string;
  minVersion?: string;
}

export function mixinJsonToModConfig(configFile: string, config: MixinConfigJson): ModMixinConfig {
  return {
    configFile,
    package: config.package,
    mixins: config.mixins,
    clientMixins: config.client,
    serverMixins: config.server,
  };
}

export function parseMixinConfigsFromZip(zip: AdmZip, configFiles: string[]): ModMixinConfig[] {
  const configs: ModMixinConfig[] = [];

  for (const configFile of configFiles) {
    const entry = zip.getEntry(configFile);
    if (!entry) {
      logger.warn(`Mixin config not found: ${configFile}`);
      continue;
    }

    try {
      const content = entry.getData().toString('utf8');
      const parsed = JSON.parse(content) as MixinConfigJson;
      configs.push(mixinJsonToModConfig(configFile, parsed));
    } catch (e) {
      logger.warn(`Failed to parse mixin config: ${configFile}`, e);
    }
  }

  return configs;
}

/**
 * Collect fully-qualified mixin class names from parsed configs.
 */
export function collectMixinClassNamesFromConfigs(configs: ModMixinConfig[]): string[] {
  const names = new Set<string>();
  for (const config of configs) {
    const pkg = config.package ?? '';
    const add = (simple: string) => names.add(pkg ? `${pkg}.${simple}` : simple);
    for (const m of config.mixins ?? []) {
      add(m);
    }
    for (const m of config.clientMixins ?? []) {
      add(m);
    }
    for (const m of config.serverMixins ?? []) {
      add(m);
    }
  }
  return [...names];
}
