import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatSchedule, buildButtonPollBlocks, slugify, parseSchedule, optionLine, monthDayOrdinal } from './index.js';

const NBSP = ' ';

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
    ['monday 09:00 CT',                 'Monday at 9:00 AM CT'],
    ['MONDAY 09:00',                    'Monday at 9:00 AM CT'],
    ['monday wednesday friday 09:00',   'Monday, Wednesday, Friday at 9:00 AM CT'],
    ['daily 08:00',                     'Daily at 8:00 AM CT'],
    ['monthly 1 09:00',                 'Monthly on the 1st at 9:00 AM CT'],
    ['monthly 15 09:00',                'Monthly on the 15th at 9:00 AM CT'],
    ['monthly 21 18:00',                'Monthly on the 21st at 6:00 PM CT'],
    ['monthly 22 18:00',                'Monthly on the 22nd at 6:00 PM CT'],
    ['monthly 23 18:00',                'Monthly on the 23rd at 6:00 PM CT'],
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

// ── parseSchedule ─────────────────────────────────────────────────────────────

describe('parseSchedule', () => {
  test('empty string returns empty freq', () => {
    assert.deepEqual(parseSchedule(''), { freq: '', days: [], time: '' });
  });

  test('null/undefined returns empty', () => {
    assert.deepEqual(parseSchedule(null), { freq: '', days: [], time: '' });
    assert.deepEqual(parseSchedule(undefined), { freq: '', days: [], time: '' });
  });

  test('daily schedule', () => {
    assert.deepEqual(parseSchedule('daily 09:00'), { freq: 'daily', days: [], time: '09:00' });
  });

  test('single-day weekly schedule', () => {
    assert.deepEqual(parseSchedule('monday 09:00'), { freq: 'weekly', days: ['monday'], time: '09:00' });
  });

  test('multi-day weekly schedule', () => {
    assert.deepEqual(parseSchedule('monday wednesday friday 09:00'), {
      freq: 'weekly',
      days: ['monday', 'wednesday', 'friday'],
      time: '09:00',
    });
  });

  test('monthly single day', () => {
    assert.deepEqual(parseSchedule('monthly 1 09:00'), { freq: 'monthly', days: ['1'], time: '09:00' });
  });

  test('monthly multiple days', () => {
    assert.deepEqual(parseSchedule('monthly 1 15 28 09:00'), {
      freq: 'monthly',
      days: ['1', '15', '28'],
      time: '09:00',
    });
  });

  test('parseSchedule is inverse of formatSchedule for daily', () => {
    const parsed = parseSchedule('daily 14:00');
    assert.equal(parsed.freq, 'daily');
    assert.equal(parsed.time, '14:00');
  });

  test('parseSchedule is inverse of formatSchedule for weekly', () => {
    const parsed = parseSchedule('tuesday thursday 17:30');
    assert.equal(parsed.freq, 'weekly');
    assert.deepEqual(parsed.days, ['tuesday', 'thursday']);
    assert.equal(parsed.time, '17:30');
  });
});

// ── monthDayOrdinal ───────────────────────────────────────────────────────────

describe('monthDayOrdinal', () => {
  const cases = [
    [1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'],
    [11, '11th'], [12, '12th'], [13, '13th'],
    [21, '21st'], [22, '22nd'], [23, '23rd'], [24, '24th'],
    [28, '28th'],
  ];

  for (const [n, expected] of cases) {
    test(`${n} → "${expected}"`, () => {
      assert.equal(monthDayOrdinal(n), expected);
    });
  }
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

  test('returns empty string for all-symbol input', () => {
    assert.equal(slugify('!!!'), '');
  });

  test('preserves numbers', () => {
    assert.equal(slugify('Poll 2024'), 'poll-2024');
  });
});

// ── optionLine ────────────────────────────────────────────────────────────────

describe('optionLine', () => {
  test('short text returns prefix + text on one line', () => {
    const result = optionLine('soccer', 'Soccer');
    assert.ok(result.startsWith(NBSP.repeat(4) + ':soccer: '));
    assert.ok(result.endsWith('Soccer'));
    assert.ok(!result.includes('\n'));
  });

  test('leading indent is exactly 4 NBSP', () => {
    const result = optionLine('one', 'A');
    assert.ok(result.startsWith(NBSP.repeat(4)));
    assert.ok(!result.startsWith(NBSP.repeat(5)));
  });

  test('long text wraps and continuation uses 11 NBSP', () => {
    const longText = 'This is a very long option that definitely exceeds thirty characters';
    const result = optionLine('one', longText);
    assert.ok(result.includes('\n'), 'should contain a newline');
    const lines = result.split('\n');
    assert.ok(lines.length > 1);
    assert.ok(lines[1].startsWith(NBSP.repeat(11)), 'continuation line should start with 11 NBSP');
  });

  test('text exactly at wrap limit does not wrap', () => {
    const text = 'A'.repeat(30);
    const result = optionLine('one', text);
    assert.ok(!result.includes('\n'));
  });

  test('multi-word text over wrap limit does wrap', () => {
    // 6 words of 6 chars each = 41 chars with spaces, well over the 30-char limit
    const text = 'abcdef abcdef abcdef abcdef abcdef abcdef';
    const result = optionLine('one', text);
    assert.ok(result.includes('\n'));
  });

  test('uses the provided emoji name in shortcode format', () => {
    const result = optionLine('robot_face', 'Hello');
    assert.ok(result.includes(':robot_face:'));
  });

  test('wrapping preserves all words', () => {
    const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
    const text = words.join(' ');
    const result = optionLine('check', text);
    for (const w of words) {
      assert.ok(result.includes(w), `missing word "${w}"`);
    }
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
    assert.equal(blocks.length, 7);
  });

  test('block count includes description block when present', () => {
    const withDesc = { ...poll, description: 'Vote for your favorite.' };
    const blocks = buildButtonPollBlocks(withDesc, {}, 'summer-sports');
    assert.equal(blocks.length, 8);
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

  test('includes an admin delete action before the marker', () => {
    const blocks = buildButtonPollBlocks(poll, {}, 'summer-sports');
    const action = blocks[blocks.length - 2];
    assert.equal(action.type, 'actions');
    assert.equal(action.elements[0].action_id, 'admin_delete_message');
    assert.equal(action.elements[0].text.text, 'Admin Delete');
  });

  test('falls back to NUMBER_EMOJIS when poll has no emojis array', () => {
    const noEmojis = { name: 'Test', options: ['Alpha', 'Beta'] };
    const blocks = buildButtonPollBlocks(noEmojis, {}, 'test');
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

  test('anonymous poll shows no voter context blocks', () => {
    const anonPoll = { ...poll, anonymous: true };
    const voters = { 0: ['U001', 'U002'] };
    const blocks = buildButtonPollBlocks(anonPoll, { 0: 2 }, 'summer-sports', voters);
    const contextBlocks = blocks.filter(b => b.type === 'context' && b.block_id !== 'poll_marker');
    assert.equal(contextBlocks.length, 0);
  });

  test('non-anonymous poll shows voter context block under voted option', () => {
    const publicPoll = { ...poll, anonymous: false };
    const voters = { 0: ['U001', 'U002'] };
    const blocks = buildButtonPollBlocks(publicPoll, { 0: 2 }, 'summer-sports', voters);
    const contextBlocks = blocks.filter(b => b.type === 'context' && b.elements?.[0]?.text?.includes('U001'));
    assert.ok(contextBlocks.length > 0, 'should have a voter context block');
  });

  test('non-anonymous poll with no voters shows no voter context blocks', () => {
    const publicPoll = { ...poll, anonymous: false };
    const blocks = buildButtonPollBlocks(publicPoll, {}, 'summer-sports', {});
    const contextBlocks = blocks.filter(b => b.type === 'context' && b.block_id !== 'poll_marker');
    assert.equal(contextBlocks.length, 0);
  });
});
