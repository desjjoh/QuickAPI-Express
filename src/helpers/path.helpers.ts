import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const rootPath = path.resolve(__dirname, '../..');

export function apiPath(path: string) {
  return `/api/v1${path}`;
}
