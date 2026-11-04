import './projectTabs.css';
import { observeNavigationTabs, revealNavigationTab } from './navigationTabs.js';
import { $, append, clearNode, addDisposableListener } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { Action } from '../../../../base/common/actions.js';
import { localize } from '../../../../nls.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProjectNavigationService } from '../common/projectNavigation.js';
import { ProjectWheel } from '../common/projectWheel.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';

export class ProjectTabs extends Disposable {
	private readonly strip: HTMLElement;
	private readonly tabs: HTMLElement;
	private readonly items = this._register(new DisposableStore());
	private readonly wheel = new ProjectWheel();

	constructor(
		parent: HTMLElement,
		@IProjectNavigationService private readonly projects: IProjectNavigationService,
		@IContextMenuService private readonly menus: IContextMenuService,
		@IHoverService private readonly hover: IHoverService,
		@INotificationService private readonly notifications: INotificationService
	) {
		super();
		this.strip = append(parent, $('.paperlight-project-strip'));
		this.tabs = append(this.strip, $('.paperlight-project-tabs.paperlight-tabs.modern-ui-editor-tab-strip.modern-ui-editor-tab-list'));
		this._register(observeNavigationTabs(this.tabs));
		this.tabs.setAttribute('role', 'tablist');
		this.tabs.setAttribute('aria-label', localize('projects', "Projects"));
		const add = append(this.strip, $('button.paperlight-project-add.codicon.codicon-add')) as HTMLButtonElement;
		add.setAttribute('aria-label', localize('addProject', "Add Project"));
		this._register(this.hover.setupManagedHover(getDefaultHoverDelegate('mouse'), add, localize('addProject', "Add Project")));
		this._register(addDisposableListener(add, 'click', () => this.run(() => this.projects.add())));
		this._register(addDisposableListener(this.strip, 'wheel', (event: WheelEvent) => {
			if (event.ctrlKey || event.shiftKey) { return; }
			event.preventDefault();
			event.stopPropagation();
			const step = this.wheel.step(event.deltaX, event.deltaY, event.deltaMode, event.timeStamp);
			const index = this.projects.projects.findIndex(project => project === this.projects.active);
			const next = this.projects.projects[Math.max(0, Math.min(this.projects.projects.length - 1, index + step))];
			if (step && next) { this.run(() => this.projects.select(next.uri)); }
		}, { passive: false }));
		this._register(this.projects.onDidChange(() => this.render()));
		this.render();
	}

	private run(action: () => Promise<unknown>): void {
		void action().catch(error => this.notifications.error(error));
	}

	private render(): void {
		const hadFocus = this.tabs.contains(this.tabs.ownerDocument.activeElement);
		this.items.clear();
		clearNode(this.tabs);
		for (const project of this.projects.projects) {
			const selected = project === this.projects.active;
			const tab = append(this.tabs, $('div.paperlight-project-tab.paperlight-tab.modern-ui-editor-tab'));
			tab.setAttribute('role', 'tab');
			tab.setAttribute('aria-label', project.name);
			tab.setAttribute('aria-selected', String(selected));
			tab.tabIndex = selected ? 0 : -1;
			tab.classList.toggle('active', selected);
			append(tab, $('span.modern-ui-editor-tab-fill'));
			append(tab, $('span.paperlight-tab-label.modern-ui-editor-tab-label')).textContent = project.name;
			const close = append(tab, $('button.paperlight-tab-close.codicon.codicon-close')) as HTMLButtonElement;
			close.tabIndex = -1;
			close.setAttribute('aria-label', localize('closeProject', "Close {0}", project.name));
			this.items.add(this.hover.setupManagedHover(getDefaultHoverDelegate('mouse'), tab, project.uri.fsPath));
			this.items.add(addDisposableListener(tab, 'click', () => this.run(() => this.projects.select(project.uri))));
			this.items.add(addDisposableListener(close, 'click', event => { event.stopPropagation(); this.run(() => this.projects.close(project.uri)); }));
			this.items.add(addDisposableListener(tab, 'mousedown', event => {
				if (event.button === 1) { event.preventDefault(); }
			}));
			this.items.add(addDisposableListener(tab, 'auxclick', event => {
				if (event.button === 1) {
					event.preventDefault();
					event.stopPropagation();
					this.run(() => this.projects.close(project.uri));
				}
			}));
			this.items.add(addDisposableListener(tab, 'keydown', event => {
				if (event.target !== tab) { return; }
				const index = this.projects.projects.indexOf(project);
				const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? this.projects.projects.length - 1 : undefined;
				if (next !== undefined) {
					event.preventDefault();
					event.stopPropagation();
					if (event.altKey) {
						this.projects.move(project.uri, next);
					} else if (this.projects.projects[next]) {
						this.run(async () => {
							await this.projects.select(this.projects.projects[next].uri);
							this.tabs.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
						});
					}
				} else if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					event.stopPropagation();
					this.run(() => this.projects.select(project.uri));
				} else if (event.key === 'F2') {
					event.preventDefault();
					event.stopPropagation();
					this.run(() => this.projects.rename(project.uri));
				}
			}));
			this.items.add(addDisposableListener(tab, 'contextmenu', event => {
				event.preventDefault();
				event.stopPropagation();
				const actions = new DisposableStore();
				this.menus.showContextMenu({
					getAnchor: () => ({ x: event.clientX, y: event.clientY }),
					getActions: () => [
						actions.add(new Action('renameProject', localize('renameProject', "Rename Project"), undefined, true, () => this.projects.rename(project.uri))),
						actions.add(new Action('closeProject', localize('closeProjectAction', "Close Project"), undefined, true, () => this.projects.close(project.uri)))
					],
					onHide: () => actions.dispose()
				});
			}));
			let origin: { x: number; y: number } | undefined;
			const clearDrag = () => {
				tab.classList.remove('dragging');
				for (const item of this.tabs.children) { item.classList.remove('drop-target'); }
			};
			const targetAt = (event: PointerEvent) => this.tabs.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.paperlight-project-tab');
			this.items.add(addDisposableListener(tab, 'pointerdown', event => {
				if (event.button !== 0 || close.contains(event.target as Node)) { return; }
				origin = { x: event.clientX, y: event.clientY };
				tab.setPointerCapture(event.pointerId);
			}));
			this.items.add(addDisposableListener(this.tabs.ownerDocument, 'pointermove', event => {
				if (!origin || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 5) { return; }
				clearDrag();
				tab.classList.add('dragging');
				targetAt(event)?.classList.add('drop-target');
			}));
			this.items.add(addDisposableListener(this.tabs.ownerDocument, 'pointerup', event => {
				if (!origin) { return; }
				const moved = Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >= 5;
				origin = undefined;
				clearDrag();
				const target = targetAt(event);
				if (moved && target && this.tabs.contains(target)) {
					event.preventDefault();
					event.stopPropagation();
					this.projects.move(project.uri, Array.from(this.tabs.children).indexOf(target));
				}
			}));
			this.items.add(addDisposableListener(this.tabs.ownerDocument, 'pointercancel', () => { origin = undefined; clearDrag(); }));
			if (selected) {
				revealNavigationTab(this.tabs);
				if (hadFocus) { tab.focus(); }
			}
		}
	}
}
