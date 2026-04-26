import { defineConfig } from 'vitest/config';

/**
 * Default `npm test`: no manual suites, no integration folder, and no tests that
 * download Minecraft JARs, Yarn/Intermediary/Mojang mappings, or hit Mojang
 * version listing — safe for offline / agents that run `npm test` repeatedly.
 *
 * Full pipeline (downloads + decompile + registry + tool handlers that need cache):
 *   npm run test:integration
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '__tests__/manual/**',
      '__tests__/integration/**',
      '__tests__/core/jar-download.test.ts',
      '__tests__/core/decompile-service.test.ts',
      '__tests__/core/mapping-service.test.ts',
      '__tests__/core/remap-service.test.ts',
      '__tests__/core/version-manager.test.ts',
      '__tests__/tools/core-tools.test.ts',
      '__tests__/tools/mod-tools.test.ts',
      '__tests__/resources/mcp-resources.test.ts',
      '__tests__/services/registry-service.test.ts',
      '__tests__/services/access-widener-service.test.ts',
    ],
    testTimeout: 120000,
    hookTimeout: 30000,
    watch: false,
    fileParallelism: false,
  },
});
