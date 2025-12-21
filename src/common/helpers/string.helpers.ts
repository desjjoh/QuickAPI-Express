import type { z } from 'zod';

export function shortenPath(path: string, max = 20): string {
  return path.length > max ? path.slice(0, max - 1) + '…' : path;
}

export function formatZodIssues(
  issues: z.core.$ZodIssue[],
  source: 'path' | 'query' | 'body',
): string {
  const parts: string[] = [];

  for (const issue of issues) {
    const path: PropertyKey[] = issue.path.filter(p => p !== undefined && p !== null);

    if (path.length === 0 || path[0] === 'body') {
      parts.push(`${source} → ${issue.message}`);
      continue;
    }

    const fieldPath: string = path.join('.');

    if (fieldPath) {
      parts.push(`${source}.${fieldPath} → ${issue.message}`);
    } else {
      parts.push(issue.message);
    }
  }

  return `Validation failed: ${parts.join('; ')}.`;
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const kb: number = value / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  const mb: number = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb: number = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}
