import { test, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

/**
 * Computed-style baseline.
 *
 * This exists to make CSS class renames verifiable. It walks the DOM across
 * several UI surfaces and records the computed styles of every element, keyed
 * by its position in the tree rather than by class name -- so the key survives
 * a rename while the styles are what get compared. If a rename drops a rule,
 * some element's computed styles change and this fails.
 *
 * Screenshots would be the obvious tool, but the editor is canvas-heavy and
 * draws a live waveform, so pixel baselines are noisy for reasons that have
 * nothing to do with CSS. Computed styles are deterministic and, for a rename,
 * strictly more precise: they fail on the actual property that got lost.
 *
 * Regenerate deliberately, never to make a red test green:
 *   UPDATE_STYLE_BASELINE=1 pnpm test:e2e style-baseline
 */

const BASELINE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '__baselines__',
  'computed-styles.json'
);

const COVERAGE_PATH = join(dirname(BASELINE_PATH), 'covered-classes.json');

const shouldUpdate = process.env.UPDATE_STYLE_BASELINE === '1';

/** Properties worth comparing: everything that moves a box or paints a pixel. */
const TRACKED_PROPERTIES = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'color',
  'background-color',
  'background-image',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-color',
  'border-radius',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'text-align',
  'text-transform',
  'text-decoration-line',
  'opacity',
  'visibility',
  'overflow-x',
  'overflow-y',
  'z-index',
  'float',
  'cursor',
  'box-shadow',
  'transform',
  'flex-direction',
  'justify-content',
  'align-items',
  'white-space',
];

/**
 * How far a px length may drift before it counts as a change.
 *
 * Text-derived widths are not portable between machines. `font-family: Arial`
 * resolves to real Arial on a Windows dev box and to Liberation Sans -- its
 * metric-compatible substitute -- on the Linux CI runner. The two agree on
 * every glyph advance by design, so the layout is the same layout, but they
 * round differently in the last fractional step and shrink-to-fit boxes land
 * about 1/64px apart. Compared exactly, this baseline records the machine that
 * wrote it rather than the stylesheet, and roughly 700 of its widths are
 * fractional, so that is not a small problem.
 *
 * Half a pixel is safe slack: a rename that drops a rule takes a whole
 * declaration with it and moves a box by whole pixels or flips a keyword.
 * Nothing meaningful hides below this threshold.
 */
const LENGTH_TOLERANCE_PX = 0.5;

const LENGTH_PATTERN = /-?\d+(?:\.\d+)?px/g;

/**
 * Compare two computed values, tolerating sub-pixel drift in px lengths.
 *
 * The non-numeric skeleton has to match exactly first -- so `2px solid` can
 * never match `2px dashed`, and a length can never match a keyword -- and only
 * then are the px numbers themselves allowed to differ within tolerance.
 * Numbers without a px unit (color channels, opacity, z-index, unitless
 * line-height) live in the skeleton and keep comparing exactly.
 */
function valuesMatch(captured, expected) {
  if (captured === expected) return true;
  if (typeof captured !== 'string' || typeof expected !== 'string') return false;

  if (captured.replace(LENGTH_PATTERN, '\0') !== expected.replace(LENGTH_PATTERN, '\0')) {
    return false;
  }

  const capturedLengths = captured.match(LENGTH_PATTERN) ?? [];
  const expectedLengths = expected.match(LENGTH_PATTERN) ?? [];
  return capturedLengths.every(
    (value, index) =>
      Math.abs(parseFloat(value) - parseFloat(expectedLengths[index])) <= LENGTH_TOLERANCE_PX
  );
}

/** Every way `captured` departs from `expected`, as readable one-liners. */
function diffScene(captured, expected) {
  const differences = [];

  for (const [path, expectedEntry] of Object.entries(expected)) {
    const capturedEntry = captured[path];
    if (!capturedEntry) {
      differences.push(`${path}: missing from capture`);
      continue;
    }

    if (capturedEntry.tag !== expectedEntry.tag) {
      differences.push(`${path}: tag <${expectedEntry.tag}> -> <${capturedEntry.tag}>`);
    }

    for (const [property, expectedValue] of Object.entries(expectedEntry.styles)) {
      const capturedValue = capturedEntry.styles[property];
      if (!valuesMatch(capturedValue, expectedValue)) {
        differences.push(`${path}: ${property}: ${expectedValue} -> ${capturedValue}`);
      }
    }

    // A property the baseline skipped as inline but the capture recorded means
    // the element stopped setting it from JS -- a real change, and one the loop
    // above cannot see because it walks the baseline's properties.
    for (const property of Object.keys(capturedEntry.styles)) {
      if (property in expectedEntry.styles) continue;
      differences.push(
        `${path}: ${property}: (was set inline) -> ${capturedEntry.styles[property]}`
      );
    }
  }

  return differences;
}

/** Hold animations and transitions still so nothing is sampled mid-flight. */
const FREEZE_MOTION = `*, *::before, *::after {
  transition: none !important;
  animation: none !important;
}`;

async function bootApp(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.addStyleTag({ content: FREEZE_MOTION });
  await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0);
  await page.waitForTimeout(600);

  const cancel = page.locator('.pk_modal_cancel');
  if (await cancel.count()) await cancel.first().click();
}

async function loadSample(page) {
  await page.getByText('here to use a sample').first().click();
  await page.waitForFunction(() => window.PKAudioEditor.engine.isReady, null, { timeout: 20_000 });
  await page.waitForTimeout(400);
}

/**
 * Snapshot every element under <html>, keyed by structural path so the key is
 * independent of the class names being renamed.
 */
function captureScene(properties) {
  const entries = {};
  const seenClasses = new Set();

  const walk = (element, path) => {
    const computed = getComputedStyle(element);
    const styles = {};

    // No author rule sets `color` on a range input, so its computed value comes
    // straight from the UA stylesheet, which the host OS themes: #101010 on
    // Windows, #9d968e on the Linux CI runner. `border-top-color` defaults to
    // currentColor and follows it. Neither paints anything -- a range control's
    // track and thumb are drawn from its appearance, and main.css styles those
    // through ::-webkit-slider-thumb and friends, which this walk never visits.
    // Recording them only pins the baseline to the machine that wrote it.
    const isRangeInput = element.tagName === 'INPUT' && element.type === 'range';

    for (const property of properties) {
      if (isRangeInput && (property === 'color' || property === 'border-top-color')) continue;

      // Skip anything the element sets inline. Those values come from JS state
      // -- live audio meters, wavesurfer's canvas positioning -- and vary run
      // to run. Skipping them costs no detection power: an inline declaration
      // already outranks the stylesheet, so if a renamed rule stopped matching,
      // the computed value here would not have changed anyway.
      if (element.style.getPropertyValue(property) !== '') continue;
      styles[property] = computed.getPropertyValue(property);
    }

    entries[path] = { tag: element.tagName.toLowerCase(), styles };

    for (const className of element.classList) {
      if (className.startsWith('pk_')) seenClasses.add(className);
    }

    let index = 0;
    for (const child of element.children) {
      walk(child, `${path}/${child.tagName.toLowerCase()}[${index}]`);
      index += 1;
    }
  };

  walk(document.documentElement, 'html');
  return { entries, classes: [...seenClasses].sort() };
}

/**
 * Each scene puts the UI into a state that exposes a different slice of the
 * stylesheet. Together they are what the baseline actually covers.
 */
const SCENES = [
  {
    name: 'editor-with-sample',
    async setup(page) {
      await loadSample(page);
    },
  },
  {
    name: 'file-menu-open',
    async setup(page) {
      await loadSample(page);
      // A real mouse click, not element.click(): the menu opens from mouse
      // events on the header, which a synthetic click does not produce.
      await page
        .locator('button', { hasText: /^File$/ })
        .first()
        .click();
      // Assert the menu actually opened. An earlier version of this scene
      // silently no-opped and captured the same DOM as the base scene, which
      // made it look like coverage it was not providing.
      await page.waitForFunction(() => {
        const menu = document.querySelector('.pk_menu');
        return menu && getComputedStyle(menu).visibility === 'visible';
      });
      await page.waitForTimeout(200);
    },
  },
  {
    name: 'export-modal',
    async setup(page) {
      await loadSample(page);
      await page.evaluate(() => document.querySelector('.pk_option[data-id="dl"]').click());
      await page.waitForSelector('.pk_modal');
      await page.waitForTimeout(300);
    },
  },
  {
    name: 'gain-modal',
    async setup(page) {
      await loadSample(page);
      await page.evaluate(() => window.PKAudioEditor.fireEvent('RequestFXUI_Gain'));
      await page.waitForSelector('.pk_modal');
      await page.waitForTimeout(300);
    },
  },
  {
    name: 'paragraphic-eq-modal',
    async setup(page) {
      await loadSample(page);
      await page.evaluate(() => window.PKAudioEditor.fireEvent('RequestActionFXUI_ParaGraphicEQ'));
      await page.waitForSelector('.pk_modal');
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'tempo-tools-modal',
    async setup(page) {
      await loadSample(page);
      await page.evaluate(() => window.PKAudioEditor.fireEvent('RequestActionTempo'));
      await page.waitForSelector('.pk_modal');
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'id3-modal',
    async setup(page) {
      await loadSample(page);
      await page.evaluate(() => window.PKAudioEditor.fireEvent('RequestActionID3'));
      await page.waitForSelector('.pk_modal');
      await page.waitForTimeout(300);
    },
  },
  {
    name: 'context-menu',
    async setup(page) {
      await loadSample(page);
      await page.locator('wave').first().click({ button: 'right' });
      await page.waitForTimeout(300);
    },
  },
  {
    name: 'local-drafts-modal',
    async setup(page) {
      await loadSample(page);
      await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const app = window.PKAudioEditor;
            setTimeout(() => reject(new Error('timed out saving session')), 15000);
            app.listenFor('DidStoreDB', () => resolve());
            app.sessions.Init((err) => {
              if (err) return reject(new Error('could not open db'));
              app.sessions.SaveSession(
                app.engine.wavesurfer.backend.buffer,
                'baseline-draft',
                'baseline draft'
              );
            });
          })
      );
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        const entry = [...document.querySelectorAll('.pk_option')].find(
          (option) => option.textContent.trim() === 'Open Local Drafts'
        );
        entry.click();
      });
      await page.waitForSelector('.pk_local_draft');
      await page.waitForTimeout(300);
    },
  },
];

test('computed styles match the recorded baseline', async ({ page }) => {
  test.setTimeout(180_000);

  const captured = {};
  const coveredClasses = new Set();

  for (const scene of SCENES) {
    await bootApp(page);
    await scene.setup(page);

    const result = await page.evaluate(captureScene, TRACKED_PROPERTIES);
    captured[scene.name] = result.entries;
    for (const className of result.classes) coveredClasses.add(className);
  }

  // A scene that fails to reach its UI state captures the same DOM as the
  // plain editor and quietly contributes nothing. Every scene after the first
  // opens something, so each must differ from the base.
  const [baseScene, ...derivedScenes] = SCENES;
  for (const scene of derivedScenes) {
    expect(
      JSON.stringify(captured[scene.name]) === JSON.stringify(captured[baseScene.name]),
      `scene "${scene.name}" captured the same DOM as "${baseScene.name}" -- it never ` +
        `reached the state it is supposed to cover`
    ).toBe(false);
  }

  if (shouldUpdate || !existsSync(BASELINE_PATH)) {
    await mkdir(dirname(BASELINE_PATH), { recursive: true });
    await writeFile(BASELINE_PATH, JSON.stringify(captured, null, 2) + '\n', 'utf8');

    // Written alongside the baseline so it is obvious which classes these
    // scenes actually put on screen -- i.e. what the baseline can vouch for.
    await writeFile(
      COVERAGE_PATH,
      JSON.stringify([...coveredClasses].sort(), null, 2) + '\n',
      'utf8'
    );

    const elementCount = Object.values(captured).reduce(
      (total, scene) => total + Object.keys(scene).length,
      0
    );
    console.log(
      `wrote baseline: ${SCENES.length} scenes, ${elementCount} elements, ` +
        `${coveredClasses.size} distinct pk_ classes exercised`
    );
    return;
  }

  const baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8'));

  // Soft assertions: report every scene that drifted, not just the first one.
  // A hard failure on scene one leaves the other eight unchecked, which turns a
  // one-line fix into as many round trips as there are broken scenes.
  for (const scene of SCENES) {
    expect(captured[scene.name], `scene "${scene.name}" missing from capture`).toBeTruthy();

    expect
      .soft(
        Object.keys(captured[scene.name]).length,
        `scene "${scene.name}" changed element count -- the DOM structure moved, not just styling`
      )
      .toBe(Object.keys(baseline[scene.name]).length);

    const differences = diffScene(captured[scene.name], baseline[scene.name]);
    const preview = differences.slice(0, 40);
    if (differences.length > preview.length) {
      preview.push(`... and ${differences.length - preview.length} more`);
    }

    expect
      .soft(differences, `computed styles changed in scene "${scene.name}":\n${preview.join('\n')}`)
      .toEqual([]);
  }
});
