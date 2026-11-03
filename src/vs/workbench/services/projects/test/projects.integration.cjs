const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

async function until(read, accepts, label) {
	for (let attempt = 0; attempt < 120; attempt++) {
		const value = await read();
		if (accepts(value)) { return value; }
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(`Timed out waiting for ${label}`);
}

exports.run = async () => {
	const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'paperlight-project-test-')));
	const command = (name, ...args) => vscode.commands.executeCommand(`paperlight.projects.${name}`, ...args);
	const alpha = vscode.Uri.file(path.join(root, 'Alpha'));
	const beta = vscode.Uri.file(path.join(root, 'Beta'));
	try {
		for (const folder of [alpha, beta]) {
			await fs.mkdir(folder.fsPath);
			await fs.writeFile(path.join(folder.fsPath, 'first.txt'), 'first\nsecond\nthird\n');
			await fs.writeFile(path.join(folder.fsPath, 'second.txt'), 'other\nfile\n');
		}
		await command('add', alpha);
		await command('add', beta);
		assert.equal(vscode.workspace.workspaceFile.scheme, 'tmp');
		let projects = await command('list');
		assert.deepEqual(projects.map(project => [project.name, project.active]), [['Alpha', false], ['Beta', true]]);
		await command('rename', alpha, 'Session Name');
		await command('move', beta, 0);
		projects = await command('list');
		assert.deepEqual(projects.map(project => project.name), ['Beta', 'Session Name']);
		assert.equal((await fs.stat(alpha.fsPath)).isDirectory(), true);
		await command('select', alpha);
		const first = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(alpha, 'first.txt'));
		let editor = await vscode.window.showTextDocument(first);
		await editor.edit(edit => edit.insert(new vscode.Position(0, 0), 'unsaved '));
		await vscode.commands.executeCommand('workbench.action.splitEditorRight');
		const second = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(alpha, 'second.txt'));
		editor = await vscode.window.showTextDocument(second, vscode.window.activeTextEditor.viewColumn);
		editor.selection = new vscode.Selection(1, 2, 1, 2);
		await command('select', beta);
		const other = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(beta, 'first.txt'));
		await vscode.window.showTextDocument(other);
		await command('select', alpha);
		await until(() => vscode.window.activeTextEditor?.document.uri.toString(), value => value === second.uri.toString(), 'restored active editor');
		assert.equal(first.isDirty, true);
		assert.equal(first.getText().startsWith('unsaved '), true);
		assert.equal(vscode.window.activeTextEditor.selection.active.line, 1);
		assert.equal(vscode.window.activeTextEditor.selection.active.character, 2);
		const alphaGroups = vscode.window.tabGroups.all.filter(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath.startsWith(alpha.fsPath)));
		assert.equal(alphaGroups.length, 2);
		await vscode.window.showTextDocument(first, alphaGroups.find(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === first.uri.toString())).viewColumn);
		await vscode.commands.executeCommand('undo');
		assert.equal(first.getText(), 'first\nsecond\nthird\n');
		await first.save();
		assert.equal(await command('close', beta), true);
		assert.deepEqual((await command('list')).map(project => project.name), ['Session Name']);
		assert.equal(vscode.workspace.workspaceFolders.length, 1);
		assert.equal(await command('close', alpha), true);
		assert.deepEqual(await command('list'), []);
		console.log('PASS project lifecycle, session-only workspace, rename, reorder, dirty buffers, undo, selected editor, and splits');
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
};
