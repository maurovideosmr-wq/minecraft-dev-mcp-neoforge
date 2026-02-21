export const DEFAULT_MATRIX_VERSIONS = [
  '1.21.11',
  '1.21.10',
  '1.20.1',
  '1.19.4',
  '26.1-snapshot-1',
  '26.1-snapshot-8',
  '26.1-snapshot-9',
] as const;

export function parseMatrixVersionsFromEnv(): string[] {
  const envList = process.env.MCP_E2E_VERSIONS?.trim();
  if (!envList) {
    return [...DEFAULT_MATRIX_VERSIONS];
  }

  return envList
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}
