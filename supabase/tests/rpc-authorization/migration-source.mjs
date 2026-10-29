import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const seal = JSON.parse(await readFile(new URL('./migration-source.json', import.meta.url), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export async function readCandidate(component) {
  assert.ok(seal.migration, 'The recorded migration filename must be set');
  const bytes = await readFile(new URL(`../../migrations/${seal.migration}`, import.meta.url));
  assert.equal(bytes.length, seal.bytes, 'Recorded migration length changed');
  assert.equal(sha(bytes), seal.sha256, 'Recorded migration seal changed');
  if (!component) return bytes.toString('utf8');
  const part = seal.components.find(entry => entry.name === component);
  assert.ok(part, `Unknown component: ${component}`);
  const slice = bytes.subarray(part.offset, part.offset + part.bytes);
  assert.equal(sha(slice), part.sha256, 'Migration component seal changed');
  return slice.toString('utf8');
}
