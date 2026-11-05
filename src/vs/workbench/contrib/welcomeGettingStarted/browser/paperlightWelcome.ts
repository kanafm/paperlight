import './media/paperlightWelcome.css';
import { $, append, addDisposableListener, Dimension, getWindow } from '../../../../base/browser/dom.js';
import { localize } from '../../../../nls.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProjectNavigationService } from '../../../services/projects/common/projectNavigation.js';
import { ResourcesDropHandler } from '../../../browser/dnd.js';

export class PaperlightWelcome extends EditorPane {
	private container: HTMLElement | undefined;
	private firstButton: HTMLButtonElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetry: ITelemetryService,
		@IThemeService theme: IThemeService,
		@IStorageService storage: IStorageService,
		@ICommandService private readonly commands: ICommandService,
		@IInstantiationService private readonly instantiation: IInstantiationService,
		@INotificationService private readonly notifications: INotificationService,
		@IProjectNavigationService private readonly projects: IProjectNavigationService
	) {
		super('gettingStartedPage', group, telemetry, theme, storage);
	}

	protected createEditor(parent: HTMLElement): void {
		const container = this.container = append(parent, $('.paperlight-welcome'));
		const content = append(container, $('.paperlight-welcome-content'));
		append(content, $('.paperlight-welcome-icon', { 'aria-hidden': 'true' }));
		append(content, $('h1', {}, 'Paperlight'));
		const closer = () => { const input = this.input; return () => input ? this.group.closeEditor(input) : Promise.resolve(true); };
		const actions = [
			{ label: localize('openProject', "Open Project…"), run: async () => { const close = closer(); await this.projects.add(); if (this.projects.active) { await close(); } } },
			{ label: localize('newFile', "New File"), run: async () => { const close = closer(); await this.commands.executeCommand('workbench.action.files.newUntitledFile'); await close(); } }
		];
		for (const action of actions) {
			const button = append(content, $<HTMLButtonElement>('button', { type: 'button' }, action.label));
			this.firstButton ??= button;
			this._register(addDisposableListener(button, 'click', () => action.run().catch(error => this.notifications.error(error))));
		}
		const drop = this.instantiation.createInstance(ResourcesDropHandler, { allowWorkspaceOpen: true });
		this._register(addDisposableListener(container, 'dragover', event => { event.preventDefault(); event.stopPropagation(); }));
		this._register(addDisposableListener(container, 'drop', event => {
			event.preventDefault();
			event.stopPropagation();
			drop.handleDrop(event, getWindow(container), () => this.group, closer()).catch(error => this.notifications.error(error));
		}));
	}

	override focus(): void { this.firstButton?.focus(); }
	layout(dimension: Dimension): void {
		if (this.container) { this.container.style.width = dimension.width + 'px'; this.container.style.height = dimension.height + 'px'; }
	}
}
