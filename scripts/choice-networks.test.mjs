/** Render Compose without starting containers or contacting the Docker daemon. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const binary = process.env.CHOICE_COMPOSE_BIN || 'docker';
const prefix = process.env.CHOICE_COMPOSE_BIN ? [] : ['compose'];
const inherited = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => !key.startsWith('CHOICE_')),
);
const fixture = {
	CHOICE_PREVIEW_ORIGIN: 'https://choice-preview.example.test',
	CHOICE_PREVIEW_APP_PASSWORD_FILE: '/fixtures/app-password',
	CHOICE_PREVIEW_DB_ADMIN_PASSWORD_FILE: '/fixtures/admin-password',
	CHOICE_PREVIEW_TUNNEL_TOKEN_FILE: '/fixtures/tunnel-token',
	CHOICE_DATABASE_SUBNET: '10.250.10.0/28',
	CHOICE_EDGE_SUBNET: '10.250.10.16/28',
	CHOICE_CONNECTOR_SUBNET: '10.250.10.32/28',
};

function render(project, env, release = false) {
	const args = [...prefix, '--project-name', project, '--file', 'ops/choice-preview/compose.yaml'];
	if (release) args.push('--file', 'ops/choice-launch/compose.yaml');
	return spawnSync(binary, [...args, 'config', '--format', 'json'], {
		cwd,
		env: { ...inherited, ...env },
		encoding: 'utf8',
		timeout: 30_000,
	});
}

for (const variable of [
	'CHOICE_DATABASE_SUBNET',
	'CHOICE_EDGE_SUBNET',
	'CHOICE_CONNECTOR_SUBNET',
]) {
	test(`refuses an unspecified ${variable} in preview and release`, () => {
		const missing = { ...fixture };
		delete missing[variable];
		for (const release of [false, true]) {
			const result = render('choice-missing-network-fixture', missing, release);
			assert.ifError(result.error);
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, new RegExp(variable));
		}
	});
}

test('preview and release retain distinct operator allocations and isolated volumes', () => {
	const releaseEnv = {
		...fixture,
		CHOICE_DATABASE_SUBNET: '10.250.11.0/28',
		CHOICE_EDGE_SUBNET: '10.250.11.16/28',
		CHOICE_CONNECTOR_SUBNET: '10.250.11.32/28',
	};
	const results = [
		render('choice-preview-fixture', fixture),
		render('choice-release-fixture', releaseEnv, true),
	];
	const configurations = results.map((result) => {
		assert.ifError(result.error);
		assert.equal(result.status, 0, result.stderr);
		return JSON.parse(result.stdout);
	});
	for (const [index, config] of configurations.entries()) {
		const env = index === 0 ? fixture : releaseEnv;
		for (const [name, variable] of [
			['database', 'CHOICE_DATABASE_SUBNET'],
			['edge', 'CHOICE_EDGE_SUBNET'],
			['connector-egress', 'CHOICE_CONNECTOR_SUBNET'],
		]) {
			assert.equal(config.networks[name].ipam.config[0].subnet, env[variable]);
			assert.equal(Boolean(config.networks[name].internal), name !== 'connector-egress');
		}
		assert.deepEqual(Object.keys(config.services).sort(), ['api', 'cloudflared', 'db']);
		for (const service of Object.values(config.services)) {
			assert.equal(service.ports?.length || 0, 0);
		}
	}
	assert.notEqual(
		configurations[0].volumes['choice-preview-data'].name,
		configurations[1].volumes['choice-preview-data'].name,
	);
	const subnets = configurations.flatMap((config) =>
		Object.values(config.networks).map((network) => network.ipam.config[0].subnet),
	);
	assert.equal(new Set(subnets).size, 6);
});
