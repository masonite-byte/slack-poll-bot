import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatSchedule, buildButtonPollBlocks, slugify } from './index.js';

// ── formatSchedule ────────────────────────────────────────────────────────────

describe('formatSchedule', () => {
  const cases = [
    ['monday 09:00',     'Monday 9:00 AM CT'],
    ['friday 17:00',     'Friday 5:00 PM CT'],
    ['wednesday 12:00',  'Wednesday 12:00 PM CT'],
    ['sunday 00:00',     'Sunday 12:00 AM CT'],
    ['tuesday 09:30',    'Tuesday 9:30 AM CT'],
    ['saturday 23:00',   'Saturday 11:00 PM CT'],
    ['thursday 08:00',   'Thursday 8:00 AM CT'],
    // trailing timezone token is stripped before parsing
    ['monday 09:00 CT',  'Monday 9:00 AM CT'],
    ['MONDAY 09:00',     'Monday 9:00 AM CT'],
  ];

  for (const [input, expected] of cases) {
    test(`"${input}" → "${expected}"`, () => {
      assert.equal(formatSchedule(input), expected);
    });
  }

  test('returns input unchanged when fewer than 2 parts', () => {
    assert.equal(formatSchedule('monday'), 'monday');
    assert.equal(formatSchedule(''), '');
  });
});

// ── slugify ───────────────────────────────────────────────────────────────────

describe('slugify', () => {
  test('lowercases and hyphenates', () => {
    assert.equal(slugify('Summer Sports'), 'summer-sports');
  });

  test('strips non-alphanumeric characters', () => {
    assert.equal(slugify("Mason's Poll!"), 'masons-poll');
  });

  test('collapses multiple spaces', () => {
    assert.equal(slugify('A   B'), 'a-b');
  });

  test('trims leading and trailing whitespace', () => {
    assert.equal(slugify('  hello  '), 'hello');
  });
});

// ── buildButtonPollBlocks ─────────────────────────────────────────────────────

describe('buildButtonPollBlocks', () => {
  const poll = {
    name: 'Summer Sports',
    options: ['Soccer', 'Basketball', 'Volleyball'],
    emojis: ['soccer', 'basketball', 'volleyball'],
  };

  test('block count: header + prompt + options + marker (no description)', () => {
    const blocks = buildButtonPollBlocks(poll, {}, 'summer-sports');
    // 1 header + 1 prompt + 3*(section+actions) + 1 marker = 9
    assert.equal(blocks.length, 9);
  });

  test('block count includes description block when present', () => {
    const withDesc = { ...poll, description: 'Vote for your favorite.' };
    const blocks = buildButtonPollBlocks(withDesc, {}, 'summer-sports');
    // 1 header + 1 prompt + 3*(section+actions) + 1 description + 1 marker = 10
    assert.equal(blocks.length, 10);
  });

  test('header block contains poll name', () => {
    const blocks = buildButtonPollBlocks(poll, {}, 'summer-sports');
    assert.match(blocks[0].text.text, /Summer Sports/);
  });

  test('each option has a section block followed by an actions block', () => {
    const blocks = buildButtonPollBlocks(poll, {}, 'summer-sports');
    for (let i = 0; i < poll.options.length; i++) {
      assert.equal(blocks[2 + 2 * i].type, 'section', `option ${i} section`);
      assert.equal(blocks[3 + 2 * i].type, 'actions', `option ${i} actions`);
    }
  });

  test('each option button has action_id poll_vote', () => {
    const blocks = buildButtonPollBlocks(poll, {}, 'summer-sports');
    for (let i = 0; i < poll.options.length; i++) {
      const btn = blocks[3 + 2 * i].elements[0];
      assert.ok(btn, `option ${i} missing button`);
      assert.equal(btn.action_id, 'poll_vote');
    }
  });

  test('button values encode slug and option index', () => {
    const blocks = buildButtonPollBlocks(poll, {}, 'summer-sports');
    for (let i = 0; i < poll.options.length; i++) {
      assert.equal(blocks[3 + 2 * i].elements[0].value, `summer-sports:${i}`);
    }
  });

  test('shows "0 votes" when count is zero', () => {
    const blocks = buildButtonPollBlocks(poll, {}, 'summer-sports');
    assert.equal(blocks[3].elements[0].text.text, '0 votes');
  });

  test('shows "1 vote" (singular) when count is 1', () => {
    const blocks = buildButtonPollBlocks(poll, { 0: 1 }, 'summer-sports');
    assert.equal(blocks[3].elements[0].text.text, '1 vote');
  });

  test('shows "N votes" (plural) for counts > 1', () => {
    const blocks = buildButtonPollBlocks(poll, { 1: 3 }, 'summer-sports');
    assert.equal(blocks[5].elements[0].text.text, '3 votes');
  });

  test('accumulates independent vote counts per option', () => {
    const blocks = buildButtonPollBlocks(poll, { 0: 2, 1: 5, 2: 1 }, 'summer-sports');
    assert.equal(blocks[3].elements[0].text.text, '2 votes');
    assert.equal(blocks[5].elements[0].text.text, '5 votes');
    assert.equal(blocks[7].elements[0].text.text, '1 vote');
  });

  test('marker block is last with correct poll_marker text', () => {
    const blocks = buildButtonPollBlocks(poll, {}, 'summer-sports');
    const marker = blocks[blocks.length - 1];
    assert.equal(marker.type, 'context');
    assert.equal(marker.elements[0].text, 'poll_marker:summer-sports');
  });

  test('falls back to NUMBER_EMOJIS when poll has no emojis array', () => {
    const noEmojis = { name: 'Test', options: ['Alpha', 'Beta'] };
    const blocks = buildButtonPollBlocks(noEmojis, {}, 'test');
    // section blocks for options are at indices 2 and 4
    assert.match(blocks[2].text.text, /:one:/);
    assert.match(blocks[4].text.text, /:two:/);
  });

  test('uses preamble from poll data when set', () => {
    const withPreamble = { ...poll, preamble: 'Which sport this week?' };
    const blocks = buildButtonPollBlocks(withPreamble, {}, 'summer-sports');
    assert.match(blocks[1].text.text, /Which sport this week\?/);
  });

  test('falls back to default preamble text when not set', () => {
    const blocks = buildButtonPollBlocks(poll, {}, 'summer-sports');
    assert.match(blocks[1].text.text, /Click a button/);
  });
});
