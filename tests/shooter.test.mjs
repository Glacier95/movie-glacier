import assert from 'node:assert/strict';
import test from 'node:test';
import { shooterSubtitleUrl } from '../dist-electron/electron/shooter.js';

test('Shooter opens a title-specific search URL in the default browser', () => {
  assert.equal(shooterSubtitleUrl({ titleEn: 'Fargo', originalTitle: 'Fargo', titleZh: '冰血暴' }),
    'https://assrt.net/sub/?searchword=fargo');
  const url = new URL(shooterSubtitleUrl({ titleEn: 'For a Few Dollars More', originalTitle: '', titleZh: '' }));
  assert.equal(url.searchParams.get('searchword'), 'for a few dollars more');
  assert.equal(url.origin, 'https://assrt.net');
});
