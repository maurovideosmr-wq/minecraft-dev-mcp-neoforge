/**
 * Access Transformer (Forge / NeoForge) — lightweight line parse + class target checks.
 * Not a full spec of every AT form; mojmap class names are expected.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCacheManager } from '../cache/cache-manager.js';
import type { MappingType } from '../types/minecraft.js';
import { logger } from '../utils/logger.js';
import { getDecompiledPath } from '../utils/paths.js';

export interface ATLine {
  lineNum: number;
  raw: string;
  accessToken: string;
  /** Primary class in Mojang/ dot form */
  className: string;
  memberName?: string;
}

export class AccessTransformerService {
  /**
   * Best-effort parse: access keyword then class; optional final token for method/field name.
   */
  parseFile(content: string, sourcePath?: string): { lines: ATLine[]; errors: string[] } {
    const errors: string[] = [];
    const lines: ATLine[] = [];
    const rows = content.split('\n');
    for (let i = 0; i < rows.length; i++) {
      const line = rows[i].trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      // Fabric access widener header — wrong file type
      if (line.startsWith('accessWidener')) {
        errors.push(
          `Line ${i + 1}: This looks like a Fabric access widener file, not an Access Transformer. Use validate_access_widener.`,
        );
        continue;
      }
      const m = this.tryParseATLine(line, i + 1);
      if (m) {
        lines.push(m);
      } else {
        errors.push(`Line ${i + 1}: Could not parse AT line: ${line.slice(0, 120)}`);
      }
    }
    if (sourcePath) {
      logger.debug(`Parsed ${lines.length} AT lines from ${sourcePath}`);
    }
    return { lines, errors: errors.slice(0, 50) };
  }

  private tryParseATLine(raw: string, lineNum: number): ATLine | null {
    // Example: "public com.example.Thing"  "public-f net.minecraft.Thing fieldName"
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      return null;
    }
    const accessToken = parts[0];
    if (!/^(default|public|protected|private)(-f|\+|-)?$/.test(accessToken)) {
      return null;
    }
    const className = parts[1];
    if (!className.includes('.')) {
      return null;
    }
    const memberName =
      parts.length >= 3 && !/^\(/.test(parts[2] ?? '') && !parts[2].includes('(')
        ? parts[2]
        : undefined;
    return { lineNum, raw, accessToken, className, memberName };
  }

  async validateAgainstMinecraft(
    atLines: ATLine[],
    mcVersion: string,
    mapping: MappingType = 'mojmap',
  ): Promise<{
    isValid: boolean;
    classErrors: string[];
    classWarnings: string[];
  }> {
    if (mapping !== 'mojmap' && mapping !== 'yarn') {
      return {
        isValid: false,
        classErrors: ['Access Transformer validation only supports mojmap or yarn decompiled source'],
        classWarnings: [],
      };
    }

    const cache = getCacheManager();
    if (!cache.hasDecompiledSource(mcVersion, mapping)) {
      return {
        isValid: false,
        classErrors: [
          `Minecraft ${mcVersion} (${mapping}) is not decompiled. Run decompile_minecraft_version first.`,
        ],
        classWarnings: [],
      };
    }

    const classErrors: string[] = [];
    const classWarnings: string[] = [];
    const decompiledPath = getDecompiledPath(mcVersion, mapping);
    const unique = [...new Set(atLines.map((l) => l.className))];

    for (const className of unique) {
      const classPath = join(decompiledPath, `${className.replace(/\./g, '/')}.java`);
      if (!existsSync(classPath)) {
        classErrors.push(`Class not found in decompiled ${mapping} sources: ${className}`);
      }
    }

    for (const line of atLines) {
      const classPath = join(decompiledPath, `${line.className.replace(/\./g, '/')}.java`);
      if (!existsSync(classPath) || !line.memberName) {
        continue;
      }
      const source = readFileSync(classPath, 'utf8');
      if (line.raw.includes('(') && line.raw.includes(')')) {
        const short = line.memberName.replace(/[()L;/\[\]]/g, '').split('.').pop() ?? line.memberName;
        if (short && !source.includes(`${short}(`) && !source.includes(` ${short}(`)) {
          classWarnings.push(
            `Line ${line.lineNum}: method-like member not clearly found in ${line.className}`,
          );
        }
      } else if (line.memberName) {
        const re = new RegExp(`\\b${line.memberName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        if (!re.test(source)) {
          classWarnings.push(
            `Line ${line.lineNum}: member "${line.memberName}" not found in ${line.className}`,
          );
        }
      }
    }

    return {
      isValid: classErrors.length === 0,
      classErrors,
      classWarnings,
    };
  }
}

let instance: AccessTransformerService | undefined;
export function getAccessTransformerService(): AccessTransformerService {
  if (!instance) {
    instance = new AccessTransformerService();
  }
  return instance;
}
