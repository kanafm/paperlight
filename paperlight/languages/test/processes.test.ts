import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { ProcessGroup, capture, processTreeMemory } from '../src/processes.ts';
import { documentUri } from '../src/ownership.ts';

test('memory includes descendants and reparented group members without double counting', () => {
	assert.equal(processTreeMemory([10, 11], [
		{ pid: 10, parent: 1, group: 10, rss: 100 },
		{ pid: 11, parent: 10, group: 10, rss: 200 },
		{ pid: 12, parent: 1, group: 10, rss: 300 },
		{ pid: 13, parent: 11, group: 13, rss: 400 },
		{ pid: 20, parent: 1, group: 20, rss: 500 }
	]), 1000);
});

test('stopping a process group also stops its child process', async () => {
	const script = "const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.stdout.write(String(c.pid)+'\\n');setInterval(()=>{},1000)";
	const group = new ProcessGroup(process.execPath, ['-e', script], tmpdir(), process.env);
	const data = once(group.child.stdout, 'data');
	await group.ready;
	const [chunk] = await data;
	const childPid = Number(chunk.toString().trim());
	try {
		assert.doesNotThrow(() => process.kill(childPid, 0));
	} finally {
		await group.stop();
	}
	assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
});

test('cancelling an environment evaluation terminates it promptly', async () => {
	const controller = new AbortController();
	const result = capture(process.execPath, ['-e', 'setInterval(()=>{},1000)'], tmpdir(), process.env, controller.signal);
	setTimeout(() => controller.abort(), 50);
	await assert.rejects(result, { name: 'AbortError' });
});

test('document ownership guard covers text documents and hierarchy items', () => {
	assert.equal(documentUri({ textDocument: { uri: 'file:///nested/main.go' } }), 'file:///nested/main.go');
	assert.equal(documentUri({ item: { uri: 'file:///nested/main.go' } }), 'file:///nested/main.go');
	assert.equal(documentUri({ query: 'symbol' }), undefined);
});
