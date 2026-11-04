import { mainWindow } from '../../../../base/browser/window.js';
import { toAction } from '../../../../base/common/actions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Event } from '../../../../base/common/event.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProjectNavigationService } from '../../../services/projects/common/projectNavigation.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../common/views.js';
import { IPaneNavigationService, compactNavigationEnabled } from '../../../browser/parts/navigation/paneNavigation.js';
import { IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { ITerminalService, ITerminalGroupService } from '../../terminal/browser/terminal.js';
import { TerminalCommandId, TERMINAL_VIEW_ID } from '../../terminal/common/terminal.js';

const selectorId = 'paperlight.navigation.sidebar';

class CompactNavigation extends Disposable {
	constructor(
		@IPaneNavigationService navigation: IPaneNavigationService,
		@IStatusbarService statusbar: IStatusbarService,
		@ITerminalService terminals: ITerminalService,
		@ITerminalGroupService groups: ITerminalGroupService,
		@ICommandService commands: ICommandService,
		@IViewDescriptorService views: IViewDescriptorService,
		@IStorageService storage: IStorageService,
		@IProjectNavigationService projects: IProjectNavigationService,
		@IExtensionService extensions: IExtensionService,
		@INotificationService notifications: INotificationService
	) {
		super();
		if (!compactNavigationEnabled) { return; }
		const entry = () => ({
			name: localize('sidebarViews', "Sidebar Views"),
			text: navigation.getLabel(ViewContainerLocation.Sidebar) + ' $(chevron-down)',
			ariaLabel: localize('sidebarSelector', "{0}, switch sidebar view", navigation.getLabel(ViewContainerLocation.Sidebar)),
			tooltip: localize('switchSidebar', "Switch Sidebar View"),
			command: selectorId
		});
		const status = this._register(statusbar.addEntry(entry(), selectorId, StatusbarAlignment.LEFT, 10000));
		this._register(navigation.onDidChange(() => status.update(entry())));
		this._register(CommandsRegistry.registerCommand(selectorId, () => {
			const anchor = mainWindow.document.getElementById(selectorId)?.querySelector<HTMLElement>('.statusbar-item-label');
			if (anchor) { navigation.showMenu(ViewContainerLocation.Sidebar, anchor); }
		}));
		this._register(navigation.registerPanelProvider(TERMINAL_VIEW_ID, {
			onDidChange: Event.any(Event.map(groups.onDidChangeInstances, () => undefined), Event.map(groups.onDidChangeActiveInstance, () => undefined), Event.map(terminals.onAnyInstanceTitleChange, () => undefined)),
			getToolbarActions: () => [
				toAction({ id: TerminalCommandId.New, label: localize('newTerminal', "New Terminal"), class: ThemeIcon.asClassName(Codicon.add), run: () => commands.executeCommand(TerminalCommandId.New) }),
				toAction({ id: TerminalCommandId.Kill, label: localize('killTerminal', "Kill Terminal"), class: ThemeIcon.asClassName(Codicon.trash), enabled: !!groups.activeInstance, run: () => groups.activeInstance ? terminals.safeDisposeTerminal(groups.activeInstance) : Promise.resolve() })
			],
			getTabActions: () => groups.instances.map((instance, index) => ({ ...toAction({
				id: 'paperlight.terminal.' + instance.instanceId,
				label: localize('terminalSession', "{0}: {1}", index + 1, instance.title),
				checked: instance === groups.activeInstance,
				run: () => groups.focusInstance(instance)
			}), close: () => terminals.safeDisposeTerminal(instance) }))
		}));
		this.initializeDefaults(projects, extensions, views, storage).catch(error => notifications.error(error));
	}

	private async initializeDefaults(projects: IProjectNavigationService, extensions: IExtensionService, views: IViewDescriptorService, storage: IStorageService): Promise<void> {
		await projects.ready;
		await extensions.whenInstalledExtensionsRegistered();
		if (!this._store.isDisposed && !storage.getBoolean('paperlight.navigation.defaults', StorageScope.PROFILE, false)) {
			for (const id of ['outline', 'timeline']) {
				const container = views.getViewContainerByViewId(id);
				if (container) { views.getViewContainerModel(container).setVisible(id, false); }
			}
			storage.store('paperlight.navigation.defaults', true, StorageScope.PROFILE, StorageTarget.MACHINE);
		}
	}
}

if (compactNavigationEnabled) {
	registerWorkbenchContribution2('paperlight.compactNavigation', CompactNavigation, WorkbenchPhase.AfterRestored);
}
