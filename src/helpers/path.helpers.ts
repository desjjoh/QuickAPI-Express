import path from 'path';
import { fileURLToPath } from 'url';

const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = path.dirname(__filename);

export const rootPath: string = path.resolve(__dirname, '../..');

export function apiPath(path: string): string {
  return `/api/v1${path}`;
}
