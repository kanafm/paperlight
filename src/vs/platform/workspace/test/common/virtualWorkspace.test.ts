import assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { Workspace, WorkspaceFolder } from '../../common/workspace.js';
import { isVirtualWorkspace } from '../../common/virtualWorkspace.js';

suite('Temporary workspace configuration', () => {
	test('keeps local extensions enabled before the first project is added', () => {
		const workspace = new Workspace('session', [], true, URI.parse('tmp:/Projects.code-workspace'), () => false);
		assert.strictEqual(isVirtualWorkspace(workspace), false);
	});

	test('still recognizes virtual folders and virtual workspace configurations', () => {
		const folder = new WorkspaceFolder({ uri: URI.parse('test:/project'), name: 'Project', index: 0 });
		assert.strictEqual(isVirtualWorkspace(new Workspace('session', [folder], true, URI.parse('tmp:/Projects.code-workspace'), () => false)), true);
		assert.strictEqual(isVirtualWorkspace(new Workspace('virtual', [], false, URI.parse('test:/workspace.code-workspace'), () => false)), true);
	});
});
