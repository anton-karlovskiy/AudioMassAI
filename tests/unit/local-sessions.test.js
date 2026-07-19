import { describe, it, expect } from 'vitest';
import { upgradeRecord } from '../../src/storage/local-sessions.js';

/** A record exactly as builds before the rename wrote it. */
function makeLegacyRecord() {
  return {
    id: 'draft-1',
    name: 'take one',
    created: 1700000000000,
    data: ['CHANNEL_0', 'CHANNEL_1'],
    data2: [4096, 4096],
    durr: 12.5,
    chans: 2,
    comp: 'l4z',
    thumb: 'data:image/png;base64,AAAA',
    samplerate: 44100,
  };
}

describe('upgradeRecord', () => {
  it('renames every legacy key on a version 1 record', () => {
    expect(upgradeRecord(makeLegacyRecord())).toEqual({
      schemaVersion: 2,
      id: 'draft-1',
      name: 'take one',
      created: 1700000000000,
      channelData: ['CHANNEL_0', 'CHANNEL_1'],
      channelByteLengths: [4096, 4096],
      duration: 12.5,
      channelCount: 2,
      compression: 'l4z',
      thumbnail: 'data:image/png;base64,AAAA',
      sampleRate: 44100,
    });
  });

  it('drops the legacy keys so nothing reads them by accident', () => {
    const upgraded = upgradeRecord(makeLegacyRecord());

    for (const legacyKey of ['data', 'data2', 'durr', 'chans', 'comp', 'thumb', 'samplerate']) {
      expect(upgraded).not.toHaveProperty(legacyKey);
    }
  });

  it('leaves a current-version record untouched', () => {
    const current = {
      schemaVersion: 2,
      id: 'draft-2',
      channelData: ['CHANNEL_0'],
      channelByteLengths: [1024],
      duration: 1,
      channelCount: 1,
      compression: 'l4z',
      thumbnail: 'thumb.png',
      sampleRate: 48000,
    };

    expect(upgradeRecord({ ...current })).toEqual(current);
  });

  it('tolerates a missing record', () => {
    expect(upgradeRecord(undefined)).toBe(undefined);
    expect(upgradeRecord(null)).toBe(null);
  });

  it('upgrades a partial legacy record without inventing keys', () => {
    expect(upgradeRecord({ id: 'draft-3', durr: 3, chans: 1 })).toEqual({
      schemaVersion: 2,
      id: 'draft-3',
      duration: 3,
      channelCount: 1,
    });
  });
});
