import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import product from '../../../../platform/product/common/product.js';

export const projectNavigationEnabled = product.nameShort === 'Paperlight';

export interface IProject {
	readonly uri: URI;
	name: string;
}

export const IProjectNavigationService = createDecorator<IProjectNavigationService>('projectNavigationService');

export interface IProjectNavigationService {
	readonly _serviceBrand: undefined;
	readonly ready: Promise<void>;
	readonly projects: readonly IProject[];
	readonly active: IProject | undefined;
	readonly onDidChange: Event<void>;
	readonly onDidSelect: Event<void>;
	add(uri?: URI): Promise<void>;
	select(uri: URI): Promise<void>;
	close(uri: URI): Promise<boolean>;
	rename(uri: URI, name?: string): Promise<void>;
	move(uri: URI, index: number): void;
}
