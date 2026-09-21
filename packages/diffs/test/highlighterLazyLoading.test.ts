import { expect, test } from 'bun:test';

// Follow static imports from the public entrypoint; backend imports must remain dynamic.
test('the public entrypoint loads no syntax backend eagerly', async () => {
  // Bun 1.4.0 resolves source modules differently inside its test runner; build in a clean runtime.
  const buildProcess = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `
    const build = await Bun.build({
      entrypoints: ['./src/index.ts'],
      packages: 'external',
      external: ['*.css?inline'],
      target: 'browser',
      splitting: true,
      metafile: true,
    });
    console.log(JSON.stringify(build.metafile));
  `,
    ],
    {
      cwd: new URL('..', import.meta.url).pathname,
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  const [output, errors, exitCode] = await Promise.all([
    new Response(buildProcess.stdout).text(),
    new Response(buildProcess.stderr).text(),
    buildProcess.exited,
  ]);
  expect(errors).toBe('');
  expect(exitCode).toBe(0);
  const metadata: Bun.BuildMetafile = JSON.parse(output);
  const inputs = metadata.inputs;
  if (inputs == null) throw new Error('Expected the build import graph');
  const entry = Object.keys(inputs).find(
    (path) => path.endsWith('/src/index.ts') || path === 'src/index.ts'
  );
  if (entry == null)
    throw new Error('Expected the public entrypoint in the import graph');
  const pending = [entry];
  const visited = new Set<string>();
  const externalImports = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    for (const dependency of inputs[path]?.imports ?? []) {
      if (dependency.kind === 'dynamic-import') continue;
      if (dependency.external === true) externalImports.add(dependency.path);
      else pending.push(dependency.path);
    }
  }
  expect(visited.size).toBeGreaterThan(20);
  expect(
    [...externalImports].filter((path) =>
      /^(shiki(?:\/|$)|@shikijs\/|@pierre\/highlights(?:\/|$))/.test(path)
    )
  ).toEqual([]);
  expect(
    [...visited].some((path) => path.includes('/highlighter/backends/shiki.'))
  ).toBe(false);
  expect(
    [...visited].some((path) =>
      path.includes('/highlighter/backends/highlights.')
    )
  ).toBe(false);
});
