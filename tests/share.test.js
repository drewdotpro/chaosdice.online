import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareFilename } from '../src/share.js';

test('share filename includes character and roll number', () => {
  assert.equal(shareFilename('Thalia Ironwood', 241), 'chaosdice-online-thalia-ironwood-roll-241.png');
});

test('share filename is safe for any name', () => {
  assert.equal(shareFilename("  Grimble O'Toole!! ", 5), 'chaosdice-online-grimble-o-toole-roll-5.png');
  assert.equal(shareFilename('Zoë Ælfwyn', 12), 'chaosdice-online-zoe-aelfwyn-roll-12.png');
  assert.equal(shareFilename('Bjørn Þórsson', 7), 'chaosdice-online-bjorn-thorsson-roll-7.png');
  assert.equal(shareFilename('../../etc/passwd', 1), 'chaosdice-online-etc-passwd-roll-1.png');
  assert.equal(shareFilename('火の竜', 3), 'chaosdice-online-character-roll-3.png');
});

test('long names are capped without a trailing dash', () => {
  const f = shareFilename('Grimble Thistlewhisker the Unreasonably Unlucky', 5000000);
  assert.equal(f, 'chaosdice-online-grimble-thistlewhisker-the-unreasonably-roll-5000000.png');
});
