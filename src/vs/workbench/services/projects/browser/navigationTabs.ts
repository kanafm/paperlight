import './navigationTabs.css';
import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';

export function revealNavigationTab(tabs: HTMLElement): void {
	tabs.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function observeNavigationTabs(tabs: HTMLElement): IDisposable {
	const observer = new ResizeObserver(() => revealNavigationTab(tabs));
	observer.observe(tabs);
	return toDisposable(() => observer.disconnect());
}
