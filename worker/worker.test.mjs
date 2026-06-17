import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatSchedule, buildButtonPollBlocks, slugify } from './index.js';

// ── formatSchedule ────────────────────────────────────────────────────────────

describe('formatSchedule', () => {
  const cases = [
    ['monday 09:00',                    'Monday at 9:00 AM CT'],
    ['friday 17:00',                    'Friday at 5:00 PM CT'],
    ['wednesday 12:00',                 'Wednesday at 12:00 PM CT'],
    ['sunday 00:00',                    'Sunday at 12:00 AM CT'],
    ['tuesday 09:30',                   'Tuesday at 9:30 AM CT'],
    ['saturday 23:00',                  'Saturday at 11:00 PM CT'],
    ['thursday 08:00',                  'Thursday at 8:00 AM CT'],
    // trailing timezone token is stripped before parsing
    ['monday 09:00 CT',                 'Monday at 9:00 AM CT'],
    ['MONDAY 09:00',                    'Monday at 9:00 AM CT'],
    // multi-day weekly
    ['monday wednesday friday 09:00',   'Monday, Wednesday, Friday at 9:00 AM CT'],
    // daily
    ['daily 08:00',                     'Daily at 8:00 AM CT'],
    // monthly — single day
    ['monthly 1 09:00',                 'Monthly on the 1st at 9:00 AM CT'],
    ['monthly 15 09:00',                'Monthly on the 15th at 9:00 AM CT'],
    ['monthly 21 18:00',                'Monthly on the 21st at 6:00 PM CT'],
    ['monthly 22 18:00',                'Monthly on the 22nd at 6:00 PM CT'],
    ['monthly 23 18:00',                'Monthly on the 23rd at 6:00 PM CT'],
    // monthly — multiple days
    ['monthly 1 15 09:00',              'Monthly on the 1st & 15th at 9:00 AM CT'],
    ['monthly 1 15 28 09:00',           'Monthly on the 1st, 15th & 28th at 9:00 AM CT'],
    ['monthly 11 12 13 09:00',          'Monthly on the 11th, 12th & 13th at 9:00 AM CT'],
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
    // 1 header + 1 prompt + 3 sections (each with accessory) + 1 marker = 6
    assert.equal(blocks.length, 6);
  });

  test('block count includes description block when present', () => {
    const withDesc = { ...poll, description: 'Vote for your favorite.' };
    const blocks = buildButtonPollBlocks(withDesc, {}, 'summer-sports');
    // 1 header + 1 prompt + 3 sections (each with accessory) + 1 description + 1 marker = 7
    assert.equal(blocks.length, 7);
  });

  test('header block contains poll name', () => {
    const blocks = buildButtonPollBlocks(poll, {}, 'summer-sports');
    assert.match(blocks[0].text.text, /Summer Sports/);
  });

  test('each option is a section block with a button accessory', () => {
    const blocks = buildButtonPollBlocks(poll, {}, 'summer-sports');
    for (let i = 0; i < poll.options.length; i++) {
      assert.equal(blocks[2 + i].type, 'section', `option ${i} section`);
      assert.ok(blocks[2 + i].accessory, `option ${i} missing accessory`);
      assert.equal(blocks[2 + i].accessory.type, 'button', `option ${i} accessory type`);
    }
  });

  test('each option button has action_id poll_vote', () => {
    const blocks = buildButtonPollBlocks(poll, {}, 'summer-sports');
    for (let i = 0; i < poll.options.length; i++) {
      assert.equal(blocks[2 + i].accessory.action_id, 'poll_vote');
    }
  });

  test('button values encode slug and option index', () => {
    const blocks = buildButtonPollBlocks(poll, {}, 'summer-sports');
    for (let i = 0; i < poll.options.length; i++) {
      assert.equal(blocks[2 + i].accessory.value, `summer-sports:${i}`);
    }
  });

  test('shows "0 votes" when count is zero', () => {
    const blocks = buildButtonPollBlocks(poll, {}, 'summer-sports');
    assert.equal(blocks[2].accessory.text.text, '0 votes');
  });

  test('shows "1 vote" (singular) when count is 1', () => {
    const blocks = buildButtonPollBlocks(poll, { 0: 1 }, 'summer-sports');
    assert.equal(blocks[2].accessory.text.text, '1 vote');
  });

  test('shows "N votes" (plural) for counts > 1', () => {
    const blocks = buildButtonPollBlocks(poll, { 1: 3 }, 'summer-sports');
    assert.equal(blocks[3].accessory.text.text, '3 votes');
  });

  test('accumulates independent vote counts per option', () => {
    const blocks = buildButtonPollBlocks(poll, { 0: 2, 1: 5, 2: 1 }, 'summer-sports');
    assert.equal(blocks[2].accessory.text.text, '2 votes');
    assert.equal(blocks[3].accessory.text.text, '5 votes');
    assert.equal(blocks[4].accessory.text.text, '1 vote');
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
    // section blocks for options are at indices 2 and 3
    assert.match(blocks[2].text.text, /:one:/);
    assert.match(blocks[3].text.text, /:two:/);
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
