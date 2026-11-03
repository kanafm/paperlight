import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { Queue } from '../../../../base/common/async.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { basename } from '../../../../base/common/resources.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Schemas } from '../../../../base/common/network.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService, IWorkspaceIdentifier } from '../../../../platform/workspace/common/workspace.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IWorkbenchConfigurationService } from '../../configuration/common/configuration.js';
import type { WorkspaceService } from '../../configuration/browser/configurationService.js';
import { IEditorGroupsService, IEditorGroup, GroupDirection } from '../../editor/common/editorGroupsService.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { EditorResourceAccessor, EditorsOrder, SideBySideEditor } from '../../../common/editor.js';
import { IProject, IProjectNavigationService, projectNavigationEnabled } from '../common/projectNavigation.js';

export class ProjectNavigationService extends Disposable implements IProjectNavigationService {
	declare readonly _serviceBrand: undefined;
	readonly ready: Promise<void>;
	readonly projects: IProject[] = [];
	active: IProject | undefined;
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	private readonly selected = this._register(new Emitter<void>());
	readonly onDidSelect = this.selected.event;
	private readonly queue = new Queue<void>();
	private readonly owners = new Map<number, IProject>();
	private readonly focused = new Map<IProject, number>();
	private readonly locks = new Map<number, boolean>();
	private readonly closing = new Set<IProject>();
	private changing = false;
	private creating: IProject | undefined;
	private session: IWorkspaceIdentifier | undefined;

	constructor(
		@IWorkspaceContextService private readonly context: WorkspaceService,
		@IWorkbenchConfigurationService private readonly configuration: IWorkbenchConfigurationService,
		@IStorageService private readonly storage: IStorageService,
		@IFileService private readonly files: IFileService,
		@IEditorGroupsService private readonly groups: IEditorGroupsService,
		@IEditorService private readonly editors: IEditorService,
		@IFileDialogService private readonly dialogs: IFileDialogService,
		@IQuickInputService private readonly input: IQuickInputService,
		@INotificationService private readonly notifications: INotificationService
	) {
		super();
		this.ready = projectNavigationEnabled ? this.initialize() : Promise.resolve();
		this.ready.catch(error => this.notifications.error(error));
	}

	private async initialize(): Promise<void> {
		await this.groups.whenReady;
		const original = this.context.getWorkspace();
		this.projects.push(...original.folders.map(folder => ({ uri: folder.uri, name: folder.name })));
		this.active = this.projects[0];
		const id = `paperlight-${generateUuid()}`;
		this.session = { id, configPath: URI.from({ scheme: Schemas.tmp, path: '/Projects.code-workspace' }) };
		if (!this.files.hasProvider(this.session.configPath)) {
			this._register(this.files.registerProvider(Schemas.tmp, this._register(new InMemoryFileSystemProvider())));
		}
		const settings = this.configuration.getConfigurationData()?.workspace.contents ?? {};
		await this.files.writeFile(this.session.configPath, VSBuffer.fromString(JSON.stringify({ folders: original.folders.map(folder => ({ uri: folder.uri.toString(), name: folder.name })), settings, transient: true })));
		await this.storage.switch(this.session, false);
		await this.configuration.initialize(this.session);
		this._register(this.groups.onDidAddGroup(group => {
			const project = this.creating ?? this.active;
			if (project) { this.owners.set(group.id, project); }
		}));
		this._register(this.groups.onDidRemoveGroup(group => {
			this.owners.delete(group.id);
			this.locks.delete(group.id);
		}));
		this._register(this.groups.onDidActivateGroup(({ group }) => {
			const project = this.owners.get(group.id);
			if (!this.changing && project) {
				this.focused.set(project, group.id);
				if (project !== this.active) { this.show(project, false); }
			}
		}));
		this._register(this.editors.onDidActiveEditorChange(() => this.routeEditor()));
		this._register(this.context.onDidChangeWorkspaceFolders(() => this.reconcile()));
		for (const group of this.groups.mainPart.groups) {
			const resource = group.activeEditor && EditorResourceAccessor.getOriginalUri(group.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
			const owner = this.owner(resource) ?? this.active;
			if (owner) { this.owners.set(group.id, owner); }
		}
		const current = this.owners.get(this.groups.activeGroup.id) ?? this.active;
		if (current) {
			this.changing = true;
			for (const group of [...this.groups.mainPart.groups]) {
				for (const editor of group.getEditors(EditorsOrder.SEQUENTIAL)) {
					const project = this.owner(EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY }));
					if (project && project !== this.owners.get(group.id)) {
						group.moveEditor(editor, this.groupFor(project));
					}
				}
			}
			this.changing = false;
			this.show(current);
		}
		this.changed.fire();
	}

	private owner(resource?: URI | null): IProject | undefined {
		const folder = resource && this.context.getWorkspaceFolder(resource);
		return folder ? this.projects.find(project => project.uri.toString() === folder.uri.toString()) : undefined;
	}

	private groupFor(project: IProject): IEditorGroup {
		const owned = this.groups.mainPart.groups.filter(group => this.owners.get(group.id) === project);
		const existing = owned.find(group => group.id === this.focused.get(project)) ?? owned[0];
		if (existing) { return existing; }
		this.creating = project;
		try {
			const empty = this.groups.mainPart.groups.find(group => !this.owners.has(group.id) && group.isEmpty);
			const group = empty ?? this.groups.mainPart.addGroup(this.groups.mainPart.activeGroup, GroupDirection.RIGHT);
			this.owners.set(group.id, project);
			return group;
		} finally {
			this.creating = undefined;
		}
	}

	private show(project: IProject, focus = true): void {
		if (this.active) { this.focused.set(this.active, this.groups.mainPart.activeGroup.id); }
		this.changing = true;
		try {
			const group = this.groupFor(project);
			this.active = project;
			for (const candidate of this.groups.mainPart.groups) {
				if (this.owners.get(candidate.id) === project) {
					this.groups.mainPart.setGroupVisible(candidate, true);
					if (this.locks.has(candidate.id)) {
						candidate.lock(this.locks.get(candidate.id)!);
						this.locks.delete(candidate.id);
					}
				}
			}
			this.groups.mainPart.activateGroup(group);
			for (const candidate of this.groups.mainPart.groups) {
				if (this.owners.get(candidate.id) !== project) {
					if (!this.locks.has(candidate.id)) { this.locks.set(candidate.id, candidate.isLocked); }
					candidate.lock(true);
					this.groups.mainPart.setGroupVisible(candidate, false);
				}
			}
			if (focus) { group.focus(); }
		} finally {
			this.changing = false;
		}
		this.selected.fire();
		this.changed.fire();
	}

	private routeEditor(): void {
		if (this.changing) { return; }
		const editor = this.editors.activeEditor;
		const project = editor && this.owner(EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY }));
		if (!editor || !project || project === this.owners.get(this.groups.activeGroup.id)) { return; }
		this.changing = true;
		try {
			this.groups.activeGroup.moveEditor(editor, this.groupFor(project));
		} finally {
			this.changing = false;
		}
		this.show(project);
	}

	private reconcile(): void {
		const folders = this.context.getWorkspace().folders;
		const removed = this.projects.filter(project => !this.closing.has(project) && !folders.some(folder => folder.uri.toString() === project.uri.toString()));
		for (const project of removed) {
			this.projects.splice(this.projects.indexOf(project), 1);
			this.focused.delete(project);
		}
		for (const folder of folders) {
			if (!this.projects.some(project => project.uri.toString() === folder.uri.toString())) {
				this.projects.push({ uri: folder.uri, name: folder.name });
			}
		}
		const fallback = this.active && !removed.includes(this.active) ? this.active : this.projects[0];
		for (const group of this.groups.mainPart.groups) {
			const owner = this.owners.get(group.id);
			if (!owner || removed.includes(owner)) {
				if (fallback) {
					this.owners.set(group.id, fallback);
				} else {
					this.owners.delete(group.id);
					group.lock(this.locks.get(group.id) ?? false);
					this.locks.delete(group.id);
					this.groups.mainPart.setGroupVisible(group, true);
				}
			}
		}
		if (this.active !== fallback) {
			this.active = undefined;
			if (fallback) { this.show(fallback); } else { this.selected.fire(); }
		}
		this.changed.fire();
	}

	async add(uri?: URI): Promise<void> {
		await this.ready;
		const selected = uri ? [uri] : await this.dialogs.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: true, title: localize('addProject', "Add Project"), openLabel: localize('addProjectButton', "Add Project") });
		if (!selected?.length) { return; }
		await this.queue.queue(async () => {
			for (const resource of selected) {
				if (resource.scheme !== Schemas.file || !(await this.files.stat(resource)).isDirectory) { throw new Error(localize('localProject', "Choose a local project folder.")); }
				await this.context.addFolders([{ uri: resource, name: basename(resource) }]);
				const project = this.projects.find(project => project.uri.toString() === resource.toString());
				if (project) { this.show(project); }
			}
		});
	}

	async select(uri: URI): Promise<void> {
		await this.ready;
		const project = this.projects.find(project => project.uri.toString() === uri.toString());
		if (project) { this.show(project); }
	}

	async close(uri: URI): Promise<boolean> {
		await this.ready;
		let closed = false;
		await this.queue.queue(async () => {
			const index = this.projects.findIndex(project => project.uri.toString() === uri.toString());
			if (index < 0) { return; }
			const project = this.projects[index];
			const owned = this.groups.mainPart.groups.filter(group => this.owners.get(group.id) === project);
			for (const group of owned) {
				if (this.groups.mainPart.getGroup(group.id) && !await group.closeAllEditors()) { return; }
			}
			this.closing.add(project);
			try {
				await this.context.removeFolders([uri]);
			} finally {
				this.closing.delete(project);
			}
			this.projects.splice(this.projects.indexOf(project), 1);
			this.focused.delete(project);
			const next = this.projects[Math.min(index, this.projects.length - 1)];
			if (this.active === project) {
				this.active = undefined;
				if (next) { this.show(next); }
			}
			for (const group of owned) {
				this.owners.delete(group.id);
				this.locks.delete(group.id);
				if (!this.groups.mainPart.getGroup(group.id)) { continue; }
				if (this.groups.mainPart.count > 1) {
					this.groups.mainPart.removeGroup(group);
				} else {
					group.lock(false);
					this.groups.mainPart.setGroupVisible(group, true);
				}
			}
			this.selected.fire();
			this.changed.fire();
			closed = true;
		});
		return closed;
	}

	async rename(uri: URI, name?: string): Promise<void> {
		await this.ready;
		const project = this.projects.find(project => project.uri.toString() === uri.toString());
		if (!project) { return; }
		const value = name ?? await this.input.input({ title: localize('renameProject', "Rename Project"), value: project.name, validateInput: async value => value.trim() ? undefined : localize('projectNameRequired', "Enter a project name.") });
		if (value?.trim()) { project.name = value.trim(); this.changed.fire(); }
	}

	move(uri: URI, index: number): void {
		const previous = this.projects.findIndex(project => project.uri.toString() === uri.toString());
		if (previous < 0) { return; }
		const [project] = this.projects.splice(previous, 1);
		this.projects.splice(Math.max(0, Math.min(index, this.projects.length)), 0, project);
		this.changed.fire();
	}
}

registerSingleton(IProjectNavigationService, ProjectNavigationService, InstantiationType.Delayed);

CommandsRegistry.registerCommand('paperlight.projects.add', (accessor, uri?: UriComponents) => accessor.get(IProjectNavigationService).add(uri && URI.revive(uri)));
CommandsRegistry.registerCommand('paperlight.projects.select', (accessor, uri: UriComponents) => accessor.get(IProjectNavigationService).select(URI.revive(uri)));
CommandsRegistry.registerCommand('paperlight.projects.close', (accessor, uri: UriComponents) => accessor.get(IProjectNavigationService).close(URI.revive(uri)));
CommandsRegistry.registerCommand('paperlight.projects.rename', (accessor, uri: UriComponents, name?: string) => accessor.get(IProjectNavigationService).rename(URI.revive(uri), name));
CommandsRegistry.registerCommand('paperlight.projects.move', (accessor, uri: UriComponents, index: number) => accessor.get(IProjectNavigationService).move(URI.revive(uri), index));
CommandsRegistry.registerCommand('paperlight.projects.list', async accessor => {
	const service = accessor.get(IProjectNavigationService);
	await service.ready;
	return service.projects.map(project => ({ uri: project.uri.toString(), name: project.name, active: project === service.active }));
});
