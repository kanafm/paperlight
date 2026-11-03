import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { externalLink, readState } from '../src/state.ts';

test('view state accepts bounded zoom and rejects malformed messages', () => {
	assert.deepEqual([
		readState({ page: 3, scale: 'page-width', left: -2, top: 800 }),
		readState({ page: 0, scale: '1', left: 0, top: 0 }),
		readState({ page: 1, scale: '1000', left: 0, top: 0 }),
		readState({ page: 1, scale: '1', left: 0, top: Infinity })
	], [{ page: 3, scale: 'page-width', left: 0, top: 800 }, undefined, undefined, undefined]);
});

test('document links only open web and mail destinations', () => {
	assert.deepEqual(['https://example.org/', 'mailto:test@example.org', 'command:workbench.action.quit', 'file:///etc/hosts', 'javascript:alert(1)', 'invalid'].map(externalLink), ['https://example.org/', 'mailto:test@example.org', undefined, undefined, undefined, undefined]);
});
