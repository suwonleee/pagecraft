import { createHash } from 'node:crypto';

export const sourceHash = (source: string) => createHash('sha256').update(source).digest('hex');
