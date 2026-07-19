import { test, expect } from '@playwright/test';

/**
 * End-to-end smoke tests for the editor.
 *
 * Each test boots the app fresh; the helpers below dismiss the first-visit
 * welcome dialog and load the bundled sample track through the real UI.
 */

async function bootApp(page) {
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0);

  // Dismiss the welcome dialog if it appeared (always shows on first visit).
  await page.waitForTimeout(600);
  const cancel = page.locator('.pk_modal_cancel');
  if (await cancel.count()) {
    await cancel.first().click();
  }

  return consoleErrors;
}

async function loadSample(page) {
  await page.getByText('here to use a sample').first().click();
  await page.waitForFunction(() => window.PKAudioEditor.engine.isReady, null, {
    timeout: 20_000,
  });
}

test('boots the editor and exposes the global bridge', async ({ page }) => {
  const consoleErrors = await bootApp(page);

  await expect(page.getByText('File').first()).toBeVisible();
  expect(await page.evaluate(() => !!window.PKAudioEditor?.engine?.wavesurfer)).toBe(true);
  expect(consoleErrors).toEqual([]);
});

test('loads the sample track and plays it', async ({ page }) => {
  const consoleErrors = await bootApp(page);
  await loadSample(page);

  const duration = await page.evaluate(() => window.PKAudioEditor.engine.wavesurfer.getDuration());
  expect(duration).toBeGreaterThan(1);

  await page.evaluate(() => window.PKAudioEditor.fireEvent('RequestPlay'));
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.PKAudioEditor.engine.wavesurfer.isPlaying())).toBe(true);

  await page.evaluate(() => window.PKAudioEditor.fireEvent('RequestPause'));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.PKAudioEditor.engine.wavesurfer.isPlaying())).toBe(false);

  expect(consoleErrors).toEqual([]);
});

test('cut, paste and undo modify the buffer correctly', async ({ page }) => {
  await bootApp(page);
  await loadSample(page);

  const duration = () => page.evaluate(() => window.PKAudioEditor.engine.wavesurfer.getDuration());

  const before = await duration();

  await page.evaluate(() => window.PKAudioEditor.fireEvent('RequestSelect', false, [1.0, 2.0]));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.PKAudioEditor.fireEvent('RequestActionCut', 1));
  await page.waitForTimeout(800);
  expect(await duration()).toBeLessThan(before);

  await page.evaluate(() => window.PKAudioEditor.fireEvent('RequestActionPaste'));
  await page.waitForTimeout(800);
  expect(Math.abs((await duration()) - before)).toBeLessThan(0.05);

  // Undo the paste: the undo stack must shrink through the event bus.
  const undoLength = await page.evaluate(
    () =>
      new Promise((resolve) => {
        window.PKAudioEditor.listenFor('DidStateChange', (undo) => resolve(undo.length));
        window.PKAudioEditor.fireEvent('StateRequestUndo');
      })
  );
  expect(undoLength).toBeLessThanOrEqual(1);
});

test('applies an effect and records it in the undo history', async ({ page }) => {
  await bootApp(page);
  await loadSample(page);

  await page.evaluate(() => window.PKAudioEditor.fireEvent('RequestSelect'));
  await page.waitForTimeout(300);

  const undoLength = await page.evaluate(
    () =>
      new Promise((resolve) => {
        window.PKAudioEditor.listenFor('DidStateChange', (undo) => resolve(undo.length));
        window.PKAudioEditor.fireEvent('RequestActionFX_Normalize', [false, 1.0]);
      })
  );
  expect(undoLength).toBe(1);
});

test('effect dialogs open and close', async ({ page }) => {
  await bootApp(page);
  await loadSample(page);

  for (const event of ['RequestFXUI_Gain', 'RequestActionFXUI_ParaGraphicEQ']) {
    await page.evaluate((name) => window.PKAudioEditor.fireEvent(name), event);
    await expect(page.locator('.pk_modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.pk_modal')).toHaveCount(0);
  }
});

/**
 * Rewrites a stored session back into the pre-rename key shape, straight
 * through IndexedDB, so the next read exercises the real upgrade path.
 */
async function downgradeStoredSession(page, id) {
  return page.evaluate((sessionId) => {
    const legacyKeys = {
      channelData: 'data',
      channelByteLengths: 'data2',
      duration: 'durr',
      channelCount: 'chans',
      compression: 'comp',
      sampleRate: 'samplerate',
      thumbnail: 'thumb',
    };

    return new Promise((resolve, reject) => {
      const open = indexedDB.open('audiomass');
      open.onerror = () => reject(new Error('could not open db'));
      open.onsuccess = () => {
        const transaction = open.result.transaction(['sessions'], 'readwrite');
        const store = transaction.objectStore('sessions');

        store.get(sessionId).onsuccess = (event) => {
          const record = event.target.result;
          delete record.schemaVersion;

          for (const currentKey in legacyKeys) {
            record[legacyKeys[currentKey]] = record[currentKey];
            delete record[currentKey];
          }

          store.put(record);
        };

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => reject(new Error('could not rewrite record'));
      };
    });
  }, id);
}

test('saves a local session and reloads it, old records included', async ({ page }) => {
  const consoleErrors = await bootApp(page);
  await loadSample(page);

  const originalDuration = await page.evaluate(() =>
    window.PKAudioEditor.engine.wavesurfer.getDuration()
  );

  const sessionId = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const app = window.PKAudioEditor;
        const id = 'e2e-' + Date.now();

        setTimeout(() => reject(new Error('timed out saving session')), 15000);

        app.listenFor('DidStoreDB', (record) => resolve(record.id));
        app.sessions.Init((err) => {
          if (err) return reject(new Error('could not open db'));
          app.sessions.SaveSession(app.engine.wavesurfer.backend.buffer, id, 'e2e draft');
        });
      })
  );

  // The record just written uses the current key names.
  const saved = await page.evaluate(
    (id) =>
      new Promise((resolve) => {
        window.PKAudioEditor.sessions.GetSession(id, (record) =>
          resolve({
            schemaVersion: record.schemaVersion,
            channelCount: record.channelCount,
            sampleRate: record.sampleRate,
            duration: record.duration,
            channels: record.channelData.length,
          })
        );
      }),
    sessionId
  );

  expect(saved.schemaVersion).toBe(2);
  expect(saved.channelCount).toBeGreaterThan(0);
  expect(saved.sampleRate).toBeGreaterThan(0);
  expect(saved.duration).toBeCloseTo(originalDuration, 1);
  expect(saved.channels).toBe(saved.channelCount);

  // A record written by an older build reads back in the current shape.
  await downgradeStoredSession(page, sessionId);

  const upgraded = await page.evaluate(
    (id) =>
      new Promise((resolve) => {
        window.PKAudioEditor.sessions.GetSession(id, (record) =>
          resolve({
            schemaVersion: record.schemaVersion,
            channelCount: record.channelCount,
            sampleRate: record.sampleRate,
            duration: record.duration,
            channels: record.channelData.length,
            hasLegacyKeys: 'durr' in record || 'chans' in record || 'data' in record,
          })
        );
      }),
    sessionId
  );

  expect(upgraded.hasLegacyKeys).toBe(false);
  expect(upgraded.schemaVersion).toBe(2);
  expect(upgraded.channelCount).toBe(saved.channelCount);
  expect(upgraded.sampleRate).toBe(saved.sampleRate);
  expect(upgraded.duration).toBeCloseTo(originalDuration, 1);

  // And the upgraded record actually loads back into the editor.
  await page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const app = window.PKAudioEditor;
        app.engine.wavesurfer.backend._add = 0;
        app.sessions.GetSession(id, (record) => {
          app.engine.LoadDB(record);
          resolve();
        });
      }),
    sessionId
  );

  await page.waitForTimeout(600);
  const reloadedDuration = await page.evaluate(() =>
    window.PKAudioEditor.engine.wavesurfer.getDuration()
  );
  expect(reloadedDuration).toBeCloseTo(originalDuration, 1);

  // The drafts menu reaches storage through the app instance; this is the
  // path that silently broke when `app.fls` was renamed.
  await page.evaluate(() => {
    const entry = [...document.querySelectorAll('.pk_opt')].find(
      (option) => option.textContent.trim() === 'Open Local Drafts'
    );
    entry.click();
  });

  const draftEntry = page.locator('.pk_modal .pk_lcldrf', { hasText: 'e2e draft' });
  await expect(draftEntry).toHaveCount(1);
  await expect(draftEntry).toContainText(sessionId);
  await page.keyboard.press('Escape');

  expect(consoleErrors).toEqual([]);
});

test('export dialog opens with format options', async ({ page }) => {
  await bootApp(page);
  await loadSample(page);

  await page.evaluate(() => document.querySelector('.pk_opt[data-id="dl"]').click());
  await expect(page.locator('.pk_modal')).toBeVisible();
  await expect(page.locator('.pk_modal input[value="mp3"]')).toHaveCount(1);
  await expect(page.locator('.pk_modal input[value="flac"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
});
