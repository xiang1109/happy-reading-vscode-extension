import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isSupportedBook } from './extractors';

const ignoredDirectoryNames = new Set(['node_modules', '.git', '.svn', '.hg']);

export function isIgnoredBookPath(filePath: string): boolean {
  return filePath.split(/[\\/]/).some(segment => ignoredDirectoryNames.has(segment.toLowerCase()));
}

export async function discoverBooks(sourcePath: string): Promise<string[]> {
  const stat = await fs.stat(sourcePath).catch(() => undefined);
  if (!stat) {
    return [];
  }
  if (stat.isFile()) {
    return isSupportedBook(sourcePath) ? [sourcePath] : [];
  }
  if (!stat.isDirectory()) {
    return [];
  }
  const result: string[] = [];
  await walk(sourcePath, result);
  return result.sort((left, right) => path.basename(left).localeCompare(path.basename(right), undefined, { sensitivity: 'base' }));
}

async function walk(folder: string, result: string[]): Promise<void> {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectoryNames.has(entry.name.toLowerCase())) {
        continue;
      }
      await walk(fullPath, result);
    } else if (entry.isFile() && isSupportedBook(fullPath)) {
      result.push(fullPath);
    }
  }
}
