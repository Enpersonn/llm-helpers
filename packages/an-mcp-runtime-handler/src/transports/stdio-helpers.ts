import type { McpTransport } from '../types.js';
import { createStdioTransport } from './stdio.js';

type NpxConfig = {
	package: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
};

type UvxConfig = {
	package: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
};

type DockerConfig = {
	image: string;
	args?: string[];
	env?: Record<string, string>;
	dockerArgs?: string[];
};

export const createNpxStdioTransport = (config: NpxConfig): McpTransport =>
	createStdioTransport({
		command: 'npx',
		args: ['-y', config.package, ...(config.args ?? [])],
		env: config.env,
		cwd: config.cwd,
	});

export const createUvxStdioTransport = (config: UvxConfig): McpTransport =>
	createStdioTransport({
		command: 'uvx',
		args: [config.package, ...(config.args ?? [])],
		env: config.env,
		cwd: config.cwd,
	});

export const createDockerStdioTransport = (config: DockerConfig): McpTransport => {
	const envFlags = Object.entries(config.env ?? []).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
	return createStdioTransport({
		command: 'docker',
		args: ['run', '-i', '--rm', ...envFlags, ...(config.dockerArgs ?? []), config.image, ...(config.args ?? [])],
	});
};
