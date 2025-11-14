export function shortenPath(path: string, max = 20): string {
  return path.length > max ? path.slice(0, max - 1) + '…' : path;
}
