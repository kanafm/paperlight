import './paneNavigation.css';
import { $, append, addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { ActionBar } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { AnchorPosition } from '../../../../base/browser/ui/contextview/contextview.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IAction, Separator, SubmenuAction, toAction } from '../../../../base/common/actions.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { localize } from '../../../../nls.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import product from '../../../../platform/product/common/product.js';
import { PaneComposite } from '../../panecomposite.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../common/views.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';

export const compactNavigationEnabled = product.nameShort === 'Paperlight';

export interface IPanelNavigationProvider {
	readonly onDidChange: Event<void>;
	getToolbarActions(): IAction[];
	getTabActions(): IAction[];
}

export const IPaneNavigationService = createDecorator<IPaneNavigationService>('paneNavigation');

export interface IPaneNavigationService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	registerPanelProvider(id: string, provider: IPanelNavigationProvider): IDisposable;
	getLabel(location: ViewContainerLocation): string;
	getToolbarActions(): IAction[];
	getTabActions(): IAction[];
	showMenu(location: ViewContainerLocation, anchor: HTMLElement): void;
}

class PaneNavigationService extends Disposable implements IPaneNavigationService {
	declare readonly _serviceBrand: undefined;
	private readonly providers = new Map<string, IPanelNavigationProvider>();
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;

	constructor(
		@IPaneCompositePartService private readonly panes: IPaneCompositePartService,
		@IViewDescriptorService private readonly views: IViewDescriptorService,
		@IContextMenuService private readonly menus: IContextMenuService,
		@ICommandService private readonly commands: ICommandService
	) {
		super();
		this._register(panes.onDidPaneCompositeOpen(() => this.changed.fire()));
		this._register(panes.onDidPaneCompositeClose(() => this.changed.fire()));
	}

	registerPanelProvider(id: string, provider: IPanelNavigationProvider): IDisposable {
		this.providers.set(id, provider);
		const listener = provider.onDidChange(() => this.changed.fire());
		this.changed.fire();
		return toDisposable(() => {
			listener.dispose();
			this.providers.delete(id);
			this.changed.fire();
		});
	}

	getLabel(location: ViewContainerLocation): string {
		const active = this.panes.getActivePaneComposite(location);
		const id = active?.getId() ?? this.panes.getLastActivePaneCompositeId(location);
		return active?.getTitle() ?? this.panes.getPaneComposite(id, location)?.name
			?? (location === ViewContainerLocation.Panel ? localize('terminal', "Terminal") : localize('explorer', "Explorer"));
	}

	getToolbarActions(): IAction[] {
		const id = this.panes.getActivePaneComposite(ViewContainerLocation.Panel)?.getId();
		return id ? this.providers.get(id)?.getToolbarActions() ?? [] : [];
	}

	getTabActions(): IAction[] {
		const id = this.panes.getActivePaneComposite(ViewContainerLocation.Panel)?.getId();
		return id ? this.providers.get(id)?.getTabActions() ?? [] : [];
	}

	showMenu(location: ViewContainerLocation, anchor: HTMLElement): void {
		const active = this.panes.getActivePaneComposite(location);
		const selected = active?.getId() ?? this.panes.getLastActivePaneCompositeId(location);
		const views = this.views.getViewContainersByLocation(location)
			.filter(view => !view.hideIfEmpty || this.views.getViewContainerModel(view).activeViewDescriptors.length > 0)
			.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
		const actions = views.map(view => toAction({
			id: view.id,
			label: this.views.getViewContainerModel(view).title,
			checked: view.id === selected,
			run: () => this.panes.openPaneComposite(view.id, location, true)
		}));
		if (location === ViewContainerLocation.Sidebar) {
			actions.push(new Separator(),
				toAction({ id: 'settings', label: localize('settings', "Settings…"), run: () => this.commands.executeCommand('workbench.action.openSettings') }),
				toAction({ id: 'accounts', label: localize('accounts', "Accounts…"), run: () => this.commands.executeCommand('workbench.action.manageAccounts') }));
		} else {
			const more = active instanceof PaneComposite ? [...active.getActions(), ...active.getSecondaryActions()] : [];
			if (more.length && !this.providers.has(selected)) {
				actions.push(new Separator(), new SubmenuAction('panel.actions', localize('moreActions', "More Actions"), more));
			}
		}
		anchor.setAttribute('aria-haspopup', 'menu');
		anchor.setAttribute('aria-expanded', 'true');
		this.menus.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => actions,
			getActionsContext: () => active instanceof PaneComposite ? active.getActionsContext() : undefined,
			anchorPosition: location === ViewContainerLocation.Sidebar ? AnchorPosition.ABOVE : AnchorPosition.BELOW,
			onHide: cancelled => {
				anchor.setAttribute('aria-expanded', 'false');
				if (cancelled) { anchor.focus(); }
			}
		});
	}
}

registerSingleton(IPaneNavigationService, PaneNavigationService, InstantiationType.Delayed);

export class CompactPanelTitle extends Disposable {
	readonly element: HTMLElement;

	constructor(
		parent: HTMLElement,
		@IPaneNavigationService navigation: IPaneNavigationService,
		@IHoverService hover: IHoverService,
		@INotificationService notifications: INotificationService
	) {
		super();
		this.element = append(parent, $('.composite.title.paperlight-panel-title'));
		const selector = append(this.element, $('button.paperlight-pane-selector')) as HTMLButtonElement;
		selector.type = 'button';
		selector.setAttribute('aria-haspopup', 'menu');
		selector.setAttribute('aria-expanded', 'false');
		const label = append(selector, $('span'));
		append(selector, $('span.codicon.codicon-chevron-down')).setAttribute('aria-hidden', 'true');
		this._register(hover.setupManagedHover(getDefaultHoverDelegate('mouse'), selector, localize('switchPanel', "Switch Panel")));
		const open = () => navigation.showMenu(ViewContainerLocation.Panel, selector);
		this._register(addDisposableListener(selector, EventType.CLICK, open));
		this._register(addDisposableListener(selector, EventType.KEY_DOWN, (event: KeyboardEvent) => {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				open();
			}
		}));
		const tabs = append(this.element, $('.paperlight-terminal-tabs'));
		tabs.setAttribute('role', 'tablist');
		tabs.setAttribute('aria-label', localize('terminalSessions', "Terminal Sessions"));
		const tabDisposables = this._register(new DisposableStore());
		const controls = append(this.element, $('.paperlight-panel-controls'));
		const toolbar = this._register(new ActionBar(controls, { ariaLabel: localize('terminalActions', "Terminal Actions") }));
		this._register(toolbar.actionRunner.onDidRun(event => { if (event.error) { notifications.error(event.error); } }));
		const update = () => {
			label.textContent = navigation.getLabel(ViewContainerLocation.Panel);
			selector.setAttribute('aria-label', localize('panelSelector', "{0}, switch panel", label.textContent));
			const restoreFocus = tabs.contains(tabs.ownerDocument.activeElement);
			const scrollLeft = tabs.scrollLeft;
			tabDisposables.clear();
			tabs.replaceChildren();
			const actions = navigation.getTabActions();
			tabs.hidden = actions.length === 0;
			const run = (action: IAction, focusTab: boolean) => {
				Promise.resolve(action.run()).then(() => {
					if (focusTab) { tabs.querySelector<HTMLElement>('[aria-selected="true"]')?.focus(); }
				}, error => notifications.error(error));
			};
			for (const [index, action] of actions.entries()) {
				const tab = append(tabs, $('button.paperlight-terminal-tab')) as HTMLButtonElement;
				tab.type = 'button';
				tab.textContent = action.label;
				tab.setAttribute('role', 'tab');
				tab.setAttribute('aria-selected', String(!!action.checked));
				tab.tabIndex = action.checked ? 0 : -1;
				tabDisposables.add(hover.setupManagedHover(getDefaultHoverDelegate('mouse'), tab, action.label));
				tabDisposables.add(addDisposableListener(tab, EventType.CLICK, () => run(action, false)));
				tabDisposables.add(addDisposableListener(tab, EventType.KEY_DOWN, (event: KeyboardEvent) => {
					const next = event.key === 'ArrowRight' ? (index + 1) % actions.length
						: event.key === 'ArrowLeft' ? (index + actions.length - 1) % actions.length
							: event.key === 'Home' ? 0 : event.key === 'End' ? actions.length - 1 : undefined;
					if (next !== undefined) {
						event.preventDefault();
						run(actions[next], true);
					}
				}));
			}
			tabs.scrollLeft = scrollLeft;
			const selected = tabs.querySelector<HTMLElement>('[aria-selected="true"]');
			if (restoreFocus) { selected?.focus(); }
			if (selected && (selected.offsetLeft < tabs.scrollLeft || selected.offsetLeft + selected.offsetWidth > tabs.scrollLeft + tabs.clientWidth)) {
				tabs.scrollLeft = selected.offsetLeft;
			}
			toolbar.clear();
			toolbar.push(navigation.getToolbarActions(), { icon: true, label: false });
		};
		this._register(navigation.onDidChange(update));
		update();
	}
}
