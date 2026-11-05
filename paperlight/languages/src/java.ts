import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolveTool, type ProjectEnvironment } from './environment.ts';
import type { Launch } from './adapters.ts';

export async function prepareJava(environment: ProjectEnvironment, launch: Launch): Promise<void> {
	const cache = path.join(environment.cache, 'java');
	const configuration = path.join(cache, 'configuration');
	await mkdir(configuration, { recursive: true });
	launch.args = [
		'-data', path.join(cache, 'workspace'), '-configuration', configuration,
		'--jvm-arg=-Xms64m', '--jvm-arg=-Djava.import.generatesMetadataFilesAtProjectRoot=false',
		'--jvm-arg=-Dmaven.repo.local=' + path.join(cache, 'maven')
	];
	if (!launch.env.GRADLE_USER_HOME) {
		launch.env.GRADLE_USER_HOME = path.join(cache, 'gradle');
		await mkdir(launch.env.GRADLE_USER_HOME, { recursive: true });
		const projectCache = path.join(cache, 'gradle-project').replace(/[^\x21-\x7e]|[\\=:#!]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
		await writeFile(path.join(launch.env.GRADLE_USER_HOME, 'gradle.properties'), 'org.gradle.projectcachedir=' + projectCache + '\norg.gradle.java.installations.auto-download=false\n');
	}
	const java = await resolveTool(environment, 'java');
	let runtime: { name: string; path: string; default: boolean } | undefined;
	if (java) {
		const home = path.dirname(path.dirname(await realpath(java.path)));
		const release = await readFile(path.join(home, 'release'), 'utf8');
		const version = /^JAVA_VERSION="(?<version>[^" ]+)"/m.exec(release)?.groups?.version;
		if (!version) { throw new Error('The project Java runtime has no version in its release file.'); }
		runtime = { name: 'JavaSE-' + (version.startsWith('1.') ? version.split('.').slice(0, 2).join('.') : version.split(/[.+_-]/)[0]), path: home, default: true };
	}
	launch.settings = { java: {
		home: runtime?.path,
		configuration: { runtimes: runtime ? [runtime] : [], updateBuildConfiguration: 'automatic' },
		import: { generatesMetadataFilesAtProjectRoot: false, gradle: {
			user: { home: launch.env.GRADLE_USER_HOME },
			home: launch.env.GRADLE_HOME,
			java: { home: runtime?.path },
			arguments: ['--project-cache-dir', path.join(cache, 'gradle-project')]
		} },
		maven: { downloadSources: false },
		eclipse: { downloadSources: false }
	} };
	launch.initializationOptions = { settings: launch.settings, workspaceFolders: [pathToFileURL(environment.root).toString()] };
}
