import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

// Run the actual inline action, without checking out or executing PR-supplied code in the policy job.
const workflow = await readFile(
	new URL('../.github/workflows/pr-policy.yml', import.meta.url),
	'utf8',
);
const literal = workflow.split(/^ {10}script: \|\r?$/m);
assert.equal(literal.length, 2, 'Expected one terminal inline policy script');
const lines = literal[1].trimEnd().split(/\r?\n/).slice(1);
assert.ok(lines.every((line) => line === '' || line.startsWith('            ')));
const script = lines.map((line) => line.slice(12)).join('\n');

const REPOSITORY = { owner: 'fixture', repo: 'choice' };
const repositoryName = 'fixture/choice';

function bot(overrides = {}) {
	return {
		number: 42,
		user: { login: 'dependabot[bot]', type: 'Bot' },
		head: { ref: 'dependabot/npm_and_yarn/vite-8.3.8', repo: { full_name: repositoryName } },
		body: '',
		changed_files: 2,
		...overrides,
	};
}

function human(overrides = {}) {
	return bot({
		user: { login: 'fixture-author', type: 'User' },
		head: { ref: 'ci/dependency-policy', repo: { full_name: repositoryName } },
		body: 'Closes #12',
		...overrides,
	});
}

async function runPolicy(
	pullRequest,
	{ pages, subIssues = [], actor = 'fixture-maintainer' } = {},
) {
	const failures = [];
	const info = [];
	const calls = [];
	const listFiles = Symbol('listFiles');
	const context = { payload: { pull_request: pullRequest }, repo: REPOSITORY, actor };
	const github = {
		rest: { pulls: { listFiles } },
		async paginate(endpoint, options) {
			assert.equal(endpoint, listFiles);
			assert.deepEqual(JSON.parse(JSON.stringify(options)), {
				...REPOSITORY,
				pull_number: 42,
				per_page: 100,
			});
			calls.push('files');
			return (pages ?? [[{ filename: 'package.json' }, { filename: 'package-lock.json' }]]).flat();
		},
		async request(endpoint, options) {
			assert.equal(endpoint, 'GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues');
			assert.equal(options.issue_number, 12);
			calls.push('sub-issues');
			return { data: subIssues };
		},
	};
	await runInNewContext(`(async () => {\n${script}\n})()`, {
		context,
		github,
		core: { setFailed: (message) => failures.push(message), info: (message) => info.push(message) },
	});
	return { failures, info, calls };
}

test('accepts verified same-repository npm updates without requiring a closing issue', async () => {
	for (const actor of ['dependabot[bot]', 'fixture-maintainer']) {
		const result = await runPolicy(bot(), { actor });
		assert.deepEqual(result.failures, []);
		assert.deepEqual(result.calls, ['files']);
		assert.match(result.info[0], /Verified dependency-only/);
	}
});

test('accepts verified GitHub Actions dependency updates', async () => {
	const result = await runPolicy(
		bot({
			head: {
				ref: 'dependabot/github_actions/actions-checkout-7',
				repo: { full_name: repositoryName },
			},
		}),
		{
			pages: [
				[
					{ filename: '.github/workflows/ci.yml' },
					{ filename: '.github/workflows/pr-policy.yaml' },
				],
			],
		},
	);
	assert.deepEqual(result.failures, []);
});

test('a human author cannot bypass policy with the bot branch or actor', async () => {
	const result = await runPolicy(human({ head: bot().head }), { actor: 'dependabot[bot]' });
	assert.match(result.failures[0], /Branch/);
	assert.deepEqual(result.calls, []);
});

test('rejects an unverified bot identity or external repository before querying files', async () => {
	for (const pullRequest of [
		bot({ user: { login: 'dependabot[bot]', type: 'User' } }),
		bot({ head: { ...bot().head, repo: { full_name: 'external/choice' } } }),
		bot({ head: { ...bot().head, repo: null } }),
	]) {
		const result = await runPolicy(pullRequest);
		assert.match(result.failures[0], /verified bot/);
		assert.deepEqual(result.calls, []);
	}
});

test('rejects unsupported and human-style branches even when the bot authored them', async () => {
	for (const branch of ['dependabot/pip/fixture-1', 'dependabot/npm_and_yarn/', 'ci/update-vite']) {
		const result = await runPolicy(bot({ head: { ...bot().head, ref: branch } }));
		assert.match(result.failures[0], /supported dependency-update branch/);
		assert.deepEqual(result.calls, []);
	}
});

test('rejects source changes and files from the wrong ecosystem', async () => {
	for (const filename of ['src/main.ts', '.github/workflows/ci.yml', 'nested/package.json']) {
		const result = await runPolicy(bot(), {
			pages: [[{ filename: 'package-lock.json' }, { filename }]],
		});
		assert.match(result.failures[0], /only dependency files/);
	}
	const result = await runPolicy(
		bot({ head: { ...bot().head, ref: 'dependabot/github_actions/action-1' } }),
		{ pages: [[{ filename: '.github/workflows/ci.yml' }, { filename: 'package.json' }]] },
	);
	assert.match(result.failures[0], /only dependency files/);
});

test('checks files from every pagination page and rejects incomplete file lists', async () => {
	const firstPage = Array.from({ length: 100 }, () => ({ filename: '.github/workflows/ci.yml' }));
	const pullRequest = bot({
		head: { ...bot().head, ref: 'dependabot/github_actions/action-1' },
		changed_files: 101,
	});
	const invalidLastPage = await runPolicy(pullRequest, {
		pages: [firstPage, [{ filename: 'src/main.ts' }]],
	});
	assert.match(invalidLastPage.failures[0], /only dependency files/);
	const validLastPage = await runPolicy(pullRequest, {
		pages: [firstPage, [{ filename: '.github/workflows/check.yaml' }]],
	});
	assert.deepEqual(validLastPage.failures, []);
	for (const pages of [[], [firstPage]]) {
		const incomplete = await runPolicy(pullRequest, { pages });
		assert.match(incomplete.failures[0], /complete Dependabot file list/);
	}
});

test('rejects a rename that hides a source-file change behind an allowed target name', async () => {
	const result = await runPolicy(bot(), {
		pages: [
			[
				{ filename: 'package.json', previous_filename: 'src/main.ts' },
				{ filename: 'package-lock.json' },
			],
		],
	});
	assert.match(result.failures[0], /only dependency files/);
});

test('continues to require a conventional branch and exactly one closing issue for humans', async () => {
	const valid = await runPolicy(human());
	assert.deepEqual(valid.failures, []);
	assert.deepEqual(valid.calls, ['sub-issues']);
	for (const body of ['', 'Related #12', 'Closes #12\nFixes #13']) {
		const result = await runPolicy(human({ body }));
		assert.match(result.failures[0], /exactly one closing directive/);
		assert.deepEqual(result.calls, []);
	}
	const branch = await runPolicy(human({ head: { ...human().head, ref: 'not-conventional' } }));
	assert.match(branch.failures[0], /Branch/);
	assert.deepEqual(branch.calls, []);
});

test('continues to reject parent issues for human PRs', async () => {
	const result = await runPolicy(human(), { subIssues: [{ number: 99 }] });
	assert.match(result.failures[0], /has sub-issues/);
	assert.deepEqual(result.calls, ['sub-issues']);
});
