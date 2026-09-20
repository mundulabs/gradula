/**
 * The live channel. It deliberately carries almost nothing — and that is the
 * only thing there is to check about it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createLive, LIVE_HEADERS } from '../src/live.mjs';

const fakeResponse = () => {
  const written = [];
  const handlers = {};
  return {
    written,
    write: (chunk) => written.push(chunk),
    on: (event, fn) => { handlers[event] = fn; },
    close: () => handlers.close?.(),
  };
};

test('a move reaches only the listeners of ITS project', () => {
  const live = createLive();
  const a = fakeResponse(); const b = fakeResponse();
  live.join('GRD', a);
  live.join('MDUS', b);

  assert.equal(live.announce('GRD', { verb: 'moved', card: 'GRD-9', actor: 'david' }), 1);
  assert.equal(a.written.length, 1);
  assert.equal(b.written.length, 0, 'another project hears nothing');
});

test('the verb and the key go through the channel — no content', () => {
  // Otherwise an open line would hold card titles whose rights may have
  // changed since it was opened. Whoever wants more asks through the door.
  const live = createLive();
  const res = fakeResponse();
  live.join('GRD', res);
  live.announce('GRD', { verb: 'moved', card: 'GRD-9', actor: 'david', title: 'GEHEIM', text: 'GEHEIM' });
  const sent = res.written[0];
  assert.match(sent, /"card":"GRD-9"/);
  assert.doesNotMatch(sent, /GEHEIM/, 'no content in the channel');
});

test('whoever leaves is forgotten', () => {
  const live = createLive();
  const res = fakeResponse();
  live.join('GRD', res);
  assert.equal(live.count(), 1);
  res.close();
  assert.equal(live.count(), 0);
  assert.equal(live.announce('GRD', { verb: 'moved', card: 'GRD-1' }), 0);
});

test('the headers keep a proxy from buffering', () => {
  // Without them a proxy holds the stream back and delivers it in gusts —
  // the line looks healthy and is not live all the same.
  assert.match(LIVE_HEADERS['Content-Type'], /text\/event-stream/);
  assert.match(LIVE_HEADERS['Cache-Control'], /no-transform/);
  assert.equal(LIVE_HEADERS['X-Accel-Buffering'], 'no');
});
