import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

function stepCondition(name, source = workflow) {
	const steps = source.split(/^ {6}- name: /m).filter((block) => block.split(/\r?\n/)[0] === name);
	assert.equal(steps.length, 1, `Expected exactly one ${name} step`);
	const conditions = [...steps[0].matchAll(/^ {8}if: ([^\r\n]+)$/gm)];
	assert.equal(conditions.length, 1, `Expected exactly one single-line ${name} condition`);
	return conditions[0][1];
}

const sonar = stepCondition('Analyze with SonarQube Cloud');
const deferred = stepCondition('Explain deferred Dependabot analysis');
const repository = 'fixture/choice';

test('condition extraction rejects missing or ambiguous step definitions', () => {
	const fixture = '      - name: Fixture\n        if: true\n';
	assert.throws(() => stepCondition('Fixture', ''), /exactly one Fixture step/);
	assert.throws(() => stepCondition('Fixture', fixture + fixture), /exactly one Fixture step/);
	assert.throws(
		() => stepCondition('Fixture', fixture.replace('        if: true\n', '')),
		/exactly one single-line Fixture condition/,
	);
	assert.throws(
		() => stepCondition('Fixture', fixture + '        if: false\n'),
		/exactly one single-line Fixture condition/,
	);
});

function pullRequest(author, actor = author, headRepository = repository) {
	return {
		event_name: 'pull_request',
		repository,
		actor,
		event: {
			pull_request: {
				user: { login: author },
				head: { repo: { full_name: headRepository } },
			},
		},
	};
}

function evaluate(condition, github) {
	const result = runInNewContext(
		condition,
		{ github },
		{
			contextCodeGeneration: { strings: false, wasm: false },
			timeout: 1000,
		},
	);
	assert.equal(typeof result, 'boolean');
	return result;
}

for (const { name, github, analyze, explain } of [
	{
		name: 'main push runs Sonar without a PR payload',
		github: { event_name: 'push', repository, actor: 'fixture-maintainer', event: {} },
		analyze: true,
		explain: false,
	},
	{
		name: 'main push by Dependabot still runs Sonar',
		github: { event_name: 'push', repository, actor: 'dependabot[bot]', event: {} },
		analyze: true,
		explain: false,
	},
	{
		name: 'same-repository human PR runs Sonar',
		github: pullRequest('fixture-author'),
		analyze: true,
		explain: false,
	},
	{
		name: 'fork PR receives no Sonar credentials or Dependabot summary',
		github: pullRequest('fixture-author', 'fixture-author', 'external/choice'),
		analyze: false,
		explain: false,
	},
	{
		name: 'Dependabot PR defers Sonar and explains the missing analysis',
		github: pullRequest('dependabot[bot]'),
		analyze: false,
		explain: true,
	},
	{
		name: 'human rerun of a Dependabot PR still defers Sonar',
		github: pullRequest('dependabot[bot]', 'fixture-maintainer'),
		analyze: false,
		explain: true,
	},
	{
		name: 'Dependabot actor cannot suppress Sonar on a human-authored PR',
		github: pullRequest('fixture-author', 'dependabot[bot]'),
		analyze: true,
		explain: false,
	},
	{
		name: 'Dependabot author never receives Sonar credentials from a fork',
		github: pullRequest('dependabot[bot]', 'fixture-maintainer', 'external/choice'),
		analyze: false,
		explain: true,
	},
]) {
	test(name, () => {
		assert.equal(evaluate(sonar, github), analyze, 'Sonar execution');
		assert.equal(evaluate(deferred, github), explain, 'Deferred-analysis summary');
	});
}
