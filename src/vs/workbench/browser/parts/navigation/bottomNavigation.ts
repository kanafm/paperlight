import './bottomNavigation.css';
import { $, append, prepend, AnimationFrameScheduler } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IMenuService, MenuId, SubmenuItemAction } from '../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { HiddenItemStrategy, MenuWorkbenchToolBar, WorkbenchToolBar } from '../../../../platform/actions/browser/toolbar.js';
import { createActionViewItem } from '../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ProjectTabs } from '../../../services/projects/browser/projectTabs.js';

export class BottomNavigation extends Disposable {
	constructor(
		parent: HTMLElement,
		rightItems: HTMLElement,
		@IInstantiationService instantiation: IInstantiationService,
		@IMenuService menus: IMenuService,
		@IContextKeyService context: IContextKeyService,
		@IWorkbenchLayoutService layout: IWorkbenchLayoutService,
		@IEditorService editors: IEditorService
	) {
		super();
		parent.classList.add('paperlight-bottom-navigation');
		const history = prepend(parent, $('.paperlight-history'));
		const historyMenu = this._register(menus.createMenu(MenuId.CommandCenter, context));
		const historyBar = this._register(instantiation.createInstance(WorkbenchToolBar, history, {
			hiddenItemStrategy: HiddenItemStrategy.NoHide,
			actionViewItemProvider: (action, options) => createActionViewItem(instantiation, action, options)
		}));
		const updateHistory = () => historyBar.setActions(historyMenu.getActions().flatMap(([, actions]) => actions).filter(action => !(action instanceof SubmenuItemAction && action.item.submenu === MenuId.CommandCenterCenter)));
		this._register(historyMenu.onDidChange(updateHistory));
		updateHistory();
		const projects = $('.paperlight-bottom-projects.modern-ui-editor-tab-group.modern-ui-editor-tab-group-active');
		parent.insertBefore(projects, rightItems);
		this._register(instantiation.createInstance(ProjectTabs, projects));
		const controls = append(parent, $('.paperlight-layout-controls'));
		this._register(instantiation.createInstance(MenuWorkbenchToolBar, controls, MenuId.LayoutControlMenu, {
			hiddenItemStrategy: HiddenItemStrategy.NoHide,
			toolbarOptions: { primaryGroup: () => true },
			actionViewItemProvider: (action, options) => createActionViewItem(instantiation, action, options)
		}));
		const compactControls = append(parent, $('.paperlight-layout-menu'));
		this._register(instantiation.createInstance(MenuWorkbenchToolBar, compactControls, MenuId.LayoutControlMenu, {
			hiddenItemStrategy: HiddenItemStrategy.NoHide,
			toolbarOptions: { primaryGroup: () => false }
		}));
		const root = layout.mainContainer;
		root.classList.add('paperlight-bottom-workbench');
		const drag = append(root, $('.paperlight-window-drag'));
		drag.setAttribute('aria-hidden', 'true');
		let inset: HTMLElement | undefined;
		const updateInset = this._register(new AnimationFrameScheduler(root, () => {
			inset?.classList.remove('paperlight-window-inset');
			inset?.style.removeProperty('--paperlight-window-inset');
			inset = undefined;
			if (root.classList.contains('fullscreen')) { return; }
			const bounds = drag.getBoundingClientRect();
			for (const part of [Parts.SIDEBAR_PART, Parts.AUXILIARYBAR_PART, Parts.PANEL_PART, Parts.EDITOR_PART]) {
				if (!layout.isVisible(part, mainWindow)) { continue; }
				const container = layout.getContainer(mainWindow, part);
				const headers = container?.querySelectorAll<HTMLElement>(':scope > .composite.title, .editor-group-container > .title');
				for (const header of headers ?? []) {
					const rect = header.getBoundingClientRect();
					if (rect.width && rect.left < bounds.right && rect.top < bounds.bottom && rect.bottom > bounds.top) {
						inset = header;
						inset.classList.add('paperlight-window-inset');
						inset.style.setProperty('--paperlight-window-inset', Math.max(0, bounds.right - rect.left) + 'px');
						return;
					}
				}
			}
		}));
		this._register(layout.onDidLayoutMainContainer(() => updateInset.schedule()));
		this._register(layout.onDidChangePartVisibility(() => updateInset.schedule()));
		this._register(editors.onDidActiveEditorChange(() => updateInset.schedule()));
		const observer = new MutationObserver(() => updateInset.schedule());
		observer.observe(root, { attributes: true, attributeFilter: ['class'] });
		this._register(toDisposable(() => {
			observer.disconnect();
			drag.remove();
			inset?.classList.remove('paperlight-window-inset');
			inset?.style.removeProperty('--paperlight-window-inset');
			root.classList.remove('paperlight-bottom-workbench');
		}));
		updateInset.schedule();
	}
}
