/**
 * Shared constants for all test files
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const TEST_VERSION = '1.21.11';
export const TEST_MAPPING = 'yarn' as const;
export const UNOBFUSCATED_TEST_VERSION = '26.1-snapshot-8';

/**
 * Pinned NeoForge E2E (MC 1.21.1 mod dev). Bump `NEOFORGE_E2E_ARTIFACT_VERSION` when you
 * intentionally move to a newer build (Maven: net.neoforged:neoforge, id e.g. 21.1.228).
 * Env overrides: MCP_NEOFORGE_MC, MCP_NEOFORGE_VERSION.
 */
export const NEOFORGE_E2E_MC = '1.21.1';
export const NEOFORGE_E2E_ARTIFACT_VERSION = '21.1.228';

// Updated to use the meteor JAR in ai_reference
export const METEOR_JAR_PATH = join(__dirname, '..', 'ai_reference', 'meteor-client-1.21.11-4.jar');
