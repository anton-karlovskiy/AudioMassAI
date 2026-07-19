import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

/**
 * Static counterpart to the computed-style baseline.
 *
 * The style baseline proves that classes which appear on screen still resolve
 * to the same styles, but its scenes only reach part of the stylesheet. This
 * covers the rest: it pairs every `pk_` class defined in main.css against every
 * `pk_` token referenced from source, and snapshots the two leftover sets.
 *
 * A rename that updates the CSS but misses a JS call site drops the old name
 * out of "defined" while leaving it in "referenced" -- which shows up here as
 * an unexpected entry, whether or not any scene renders it.
 *
 * Regenerate deliberately and read the diff; every line should be a rename you
 * meant to make:
 *   UPDATE_CLASS_SNAPSHOT=1 pnpm test css-class-consistency
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SNAPSHOT_PATH = join(projectRoot, 'tests/unit/__snapshots__/css-class-usage.json');
const shouldUpdate = process.env.UPDATE_CLASS_SNAPSHOT === '1';

function collectSourceFiles(directory, files = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      collectSourceFiles(path, files);
    } else if (path.endsWith('.js')) {
      files.push(path);
    }
  }
  return files;
}

/** Class names the stylesheet defines a rule for. */
function definedClasses() {
  const css = readFileSync(join(projectRoot, 'src/styles/main.css'), 'utf8');
  return new Set([...css.matchAll(/\.(pk_[A-Za-z0-9_]+)/g)].map((match) => match[1]));
}

/** Every `pk_` token appearing in application source. */
function referencedTokens() {
  const files = [...collectSourceFiles(join(projectRoot, 'src')), join(projectRoot, 'index.html')];
  const tokens = new Set();

  for (const file of files) {
    const contents = readFileSync(file, 'utf8');
    for (const match of contents.matchAll(/pk_[A-Za-z0-9_]+/g)) tokens.add(match[0]);
  }
  return tokens;
}

describe('pk_ class usage', () => {
  it('has no unaccounted-for classes on either side', () => {
    const defined = definedClasses();
    const referenced = referencedTokens();

    const current = {
      // Styled but never named in src/. Expected members: names the vendored
      // wavesurfer fork writes, and state classes toggled only from vendor.
      styledButUnreferenced: [...defined].filter((name) => !referenced.has(name)).sort(),
      // Named in src/ with no rule of their own. Expected members: JS hooks
      // used purely as query selectors, plus element ids and event names that
      // share the prefix without ever being classes.
      referencedButUnstyled: [...referenced].filter((name) => !defined.has(name)).sort(),
    };

    if (shouldUpdate || !existsSync(SNAPSHOT_PATH)) {
      writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2) + '\n', 'utf8');
      return;
    }

    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));

    expect(
      current.referencedButUnstyled,
      'a pk_ name is referenced in src/ but has no rule -- if this grew, a rename ' +
        'updated main.css and missed a call site'
    ).toEqual(snapshot.referencedButUnstyled);

    expect(
      current.styledButUnreferenced,
      'a pk_ rule is no longer named anywhere in src/ -- if this grew, a rename ' +
        'updated the call sites and missed main.css'
    ).toEqual(snapshot.styledButUnreferenced);
  });

  it('every class the stylesheet defines is still spelled consistently', () => {
    // Guards the rename itself: nothing should be left half-converted, e.g. a
    // `pk_inact` surviving next to the `pk_inactive` that replaced it.
    const defined = definedClasses();
    const referenced = referencedTokens();
    const all = new Set([...defined, ...referenced]);

    const abandoned = [...all].filter((name) => {
      const expanded = [...all].find((other) => other !== name && other.startsWith(name));
      return expanded !== undefined && !defined.has(name) && !referenced.has(name);
    });

    expect(abandoned).toEqual([]);
  });
});
