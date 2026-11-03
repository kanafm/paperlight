import { BaseActionViewItem, IBaseActionViewItemOptions } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { IAction } from '../../../../base/common/actions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ProjectTabs } from './projectTabs.js';

export class ProjectTabsViewItem extends BaseActionViewItem {
	constructor(
		action: IAction,
		options: IBaseActionViewItemOptions,
		@IInstantiationService private readonly instantiation: IInstantiationService
	) {
		super(undefined, action, options);
	}

	override render(container: HTMLElement): void {
		this.element = container;
		container.classList.add('paperlight-project-action');
		this._register(this.instantiation.createInstance(ProjectTabs, container));
	}

	override focus(): void {
		(this.element?.querySelector<HTMLElement>('[aria-selected="true"]') ?? this.element?.querySelector('button'))?.focus();
	}

	override get trapsArrowNavigation(): boolean {
		return true;
	}
}
