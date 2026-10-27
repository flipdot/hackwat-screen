/*
 * Smoke tests for the HackWat screen data server.
 *
 * Unit-tests the wiki table parser and runs the express app against a
 * stubbed fetch so the whole request pipeline is exercised without
 * network access.
 *
 * Usage: node --test test/
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  app,
  getLine,
  getTableRow,
  parseTable,
  getRowNo,
  mapRowToTalk,
} = require('../getData.js');

// A fixture in the shape of the raw wiki page the server parses:
// the day-1 date sits inside the first table row, each further day
// starts with a date row followed by one header row.
const FIXTURE = [
  '== Programm ==',
  '',
  '|| 2018-06-01 Freitag ||  ||  ||  ||  ||  ||',
  '|| Uhrzeit || Ende || Sprecher || Titel || Raum || Aufnahme ||',
  '|| 10:00 || 12:00 || Alice Muster || Eröffnung || Bühne || ja ||',
  '|| 13:00 || 14:00 || Bob Beispiel || Secure Hacking || Raum A || nein ||',
  '|| 2018-06-02 ||  ||  ||  ||  ||  ||',
  '|| Uhrzeit || Ende || Sprecher || Titel || Raum || Aufnahme ||',
  '|| 09:30 || 11:00 || Carla Code || Web Hacking || Bühne || ja ||',
  '|| 2018-06-03 ||  ||  ||  ||  ||  ||',
  '|| Uhrzeit || Ende || Sprecher || Titel || Raum || Aufnahme ||',
  '|| 10:00 || 11:30 || Dana Demo || Keynote || Bühne || ja ||',
  '',
  '== Footer ==',
].join('\n');

test('getTableRow parses a wiki table row', () => {
  const row = getTableRow('|| 10:00 || 12:00 || Alice || Talk || Bühne || ja ||');
  assert.deepEqual(row, ['10:00', '12:00', 'Alice', 'Talk', 'Bühne', 'ja']);
});

test('getTableRow returns null for non-table lines', () => {
  assert.equal(getTableRow('some plain text'), null);
  assert.equal(getTableRow('|| not closed'), null);
  assert.equal(getTableRow(''), null);
});

test('parseTable stops at the first non-table line', () => {
  const lines = FIXTURE.split('\n');
  const table = parseTable(lines, 2);
  assert.equal(table.length, 10);
  assert.deepEqual(table[0], ['2018-06-01 Freitag', '', '', '', '', '']);
});

test('getLine finds the title line', () => {
  const lines = FIXTURE.split('\n');
  assert.equal(getLine(lines, '2018-06-01 Freitag'), 2);
});

test('getRowNo finds the row containing the text', () => {
  const lines = FIXTURE.split('\n');
  const table = parseTable(lines, 2);
  assert.equal(getRowNo(table, '2018-06-02'), 4);
  assert.equal(getRowNo(table, 'does not exist'), null);
});

test('mapRowToTalk maps the columns to talk fields', () => {
  const talk = mapRowToTalk(['10:00', '12:00', 'Alice', 'Eröffnung', 'Bühne', 'ja']);
  assert.deepEqual(talk, {
    start: '10:00',
    end: '12:00',
    speaker: 'Alice',
    title: 'Eröffnung',
    room: 'Bühne',
    recorded: 'ja',
  });
});

test('GET / serves the parsed talk schedule', async () => {
  const realFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    assert.equal(url, 'https://flipdot.org/wiki/HackWat?action=raw');
    return new Response(FIXTURE, { status: 200 });
  };

  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const port = server.address().port;

    const res = await realFetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.deepEqual(Object.keys(data.talks).sort(), [
      '2018-06-01',
      '2018-06-02',
      '2018-06-03',
    ]);

    assert.equal(data.talks['2018-06-01'].length, 2);
    assert.deepEqual(data.talks['2018-06-01'][0], {
      start: '10:00',
      end: '12:00',
      speaker: 'Alice Muster',
      title: 'Eröffnung',
      room: 'Bühne',
      recorded: 'ja',
    });

    assert.equal(data.talks['2018-06-02'].length, 1);
    assert.equal(data.talks['2018-06-02'][0].speaker, 'Carla Code');

    assert.equal(data.talks['2018-06-03'].length, 1);
    assert.equal(data.talks['2018-06-03'][0].title, 'Keynote');
  } finally {
    server.close();
    globalThis.fetch = realFetch;
  }
});
