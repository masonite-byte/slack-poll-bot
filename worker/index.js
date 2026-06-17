import { which as emojiWhich } from 'node-emoji';

const HELP_TEXT = [
  'Supported slash commands:',
  '/results   - show the current poll results.',
  '/newpoll   - pick and post a poll from a dropdown.',
  '/runoff    - start a runoff poll when tied.',
  '/delete    - permanently delete a custom poll (authors only).',
  '/create    - create a custom poll via a form.',
  '/polls     - list all available custom polls.',
  '/schedule  - show the weekly poll schedule.',
  '/vote      - how to vote.',
  '/about     - about this bot.',
  '/ping      - check that the bot is alive.',
  '/help      - show this help text.',
].join('\n');

const POLL_OPTIONS_TEXT = [
  ':soccer: Soccer',
  ':basketball: Basketball',
  ':flying_disc: Ultimate Frisbee',
  ':volleyball: Volleyball',
  ':athletic_shoe: Hackeysack',
  ':question: Other?????',
].join('\n');

const ABOUT_TEXT = [
  '🤖 *Poll-inator 3000*',
  '',
  'Built by Mason Womack to solve the most pressing problem in the modern workplace: what sport should we play this week?',
  '',
  'Capabilities:',
  "• Posts weekly polls so humans don't have to think",
  '• Counts emoji reactions with suspicious accuracy',
  '• Handles ties through democratic runoff elections',
  '• Supports custom polls created right from Slack',
  '• Runs on Cloudflare because servers cost money',
  '',
  'Powered by Go, Slack, and GitHub Actions.',
  '',
  '_This bot has strong opinions about Ultimate Frisbee._',
].join('\n');

// buildScheduleText fetches custom polls with schedules and builds the /schedule response.
async function buildScheduleText(env) {
  const lines = [
    '📅 *Poll Schedule*',
    '',
    '*Weekly Sports Poll*',
    '• *Monday 9:00 AM CT* — Weekly poll posted',
    '• *Tuesday 5:00 PM CT* — Results posted, voters notified, runoff if tied',
  ];

  let customLines = [];
  try {
    const slugs = await listPolls(env) || [];
    for (const slug of slugs) {
      const data = await getPollData(slug, env);
      if (!data?.schedule) continue;
      const label = data.name || slug;
      customLines.push(`• *${label}* — ${formatSchedule(data.schedule)}`);
    }
  } catch (e) {
    console.error('buildScheduleText: failed to fetch polls', e);
  }

  if (customLines.length) {
    lines.push('', '*Custom Polls*', ...customLines);
  }

  lines.push('', 'All times are Central Time. Polls run automatically — no human required.');
  return lines.join('\n');
}

// formatSchedule converts schedule strings to human-readable CT times.
// Handles: "monday 09:00", "monday wednesday 09:00", "daily 09:00", "monthly 15 09:00"
function formatSchedule(schedule) {
  const parts = schedule.trim().toLowerCase().replace(/\s+(ct|cdt|cst)$/i, '').split(/\s+/);
  if (parts.length < 2) return schedule;
  const fmtTime = (hhmm) => {
    const [hStr, mStr = '00'] = hhmm.split(':');
    const h = parseInt(hStr, 10);
    const h12 = h % 12 || 12;
    return `${h12}:${mStr} ${h >= 12 ? 'PM' : 'AM'}`;
  };
  if (parts[0] === 'daily') return `Daily at ${fmtTime(parts[1])} CT`;
  if (parts[0] === 'monthly') {
    if (parts.length < 3) return schedule;
    const timeIdx = parts.findIndex((p, i) => i > 0 && /^\d{1,2}:\d{2}$/.test(p));
    if (timeIdx < 0) return schedule;
    const ordinal = (n) => {
      const s = [11, 12, 13].includes(n) ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
      return `${n}${s}`;
    };
    const dayNums = parts.slice(1, timeIdx).map(d => ordinal(parseInt(d, 10)));
    const dayStr = dayNums.length <= 1 ? dayNums[0] : `${dayNums.slice(0, -1).join(', ')} & ${dayNums[dayNums.length - 1]}`;
    return `Monthly on the ${dayStr} at ${fmtTime(parts[timeIdx])} CT`;
  }
  // Weekly: one or more weekday names then HH:MM
  const timeIdx = parts.findIndex(p => /^\d{1,2}:\d{2}$/.test(p));
  if (timeIdx < 0) return schedule;
  const days = parts.slice(0, timeIdx).map(d => d.charAt(0).toUpperCase() + d.slice(1));
  return `${days.join(', ')} at ${fmtTime(parts[timeIdx])} CT`;
}

// ── Signature verification ────────────────────────────────────────────────────

async function verifySlackSignature(request, body, signingSecret) {
  const timestamp = request.headers.get('X-Slack-Request-Timestamp');
  const slackSig = request.headers.get('X-Slack-Signature');
  if (!timestamp || !slackSig) return false;

  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const raw = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`v0:${timestamp}:${body}`),
  );
  const computed = 'v0=' + Array.from(new Uint8Array(raw))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return computed === slackSig;
}

// ── GitHub helpers ────────────────────────────────────────────────────────────

async function triggerWorkflow(workflowFile, env, inputs = {}) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${workflowFile}/dispatches`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'slack-poll-bot',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: 'main', inputs }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub API ${resp.status}: ${text}`);
  }
}

const NUMBER_EMOJIS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

const WINNER_MESSAGES = [
  "Congratulations... your sheep mentality paid off. *%s* won! 🐑",
  "Democracy has spoken and for once you were on the right side. *%s* won! 🎉",
  "Your vote actually counted for something. Shocking, we know. *%s* won! 🏆",
  "You backed the right horse this time. *%s* won! 🐴",
  "Even a broken clock is right twice a day. *%s* won! ⏰",
  "Popular opinion prevails, and so do you. *%s* won! 🥇",
  "The herd has spoken, and you were proudly part of it. *%s* won! 🎊",
  "You voted with the majority. Truly a courageous act of absolutely no independent thought. *%s* won! 🧠",
  "Incredible. You picked the most popular option. A bold, safe, utterly predictable move. *%s* won! 👏",
  "Science has yet to determine whether you predicted this or just got lucky. Either way, *%s* won! 🔬",
  "Your ancestors are weeping tears of joy. Or they would be, if they cared about this. *%s* won! 👴",
  "Against all odds — well, actually with all odds — *%s* won and so did you! 📊",
  "You voted for *%s* and it won. Please do not let this go to your head. We're begging you. 🙏",
  "The algorithm has determined you made the correct choice this week. Do not expect consistency. *%s* won! 🤖",
];

const LOSER_MESSAGES = [
  "James Maddison sympathizes with you... *%s* won. Your choice didn't make the cut. 💔",
  "The tyranny of the majority strikes again. *%s* won. Your vote was noted... and ignored. 🗳️",
  "Bold choice. Wrong choice. *%s* won. 😬",
  "Not everyone can be right. *%s* won. Better luck next week! 😔",
  "The people have spoken, and they said 'not that'. *%s* won. 😅",
  "Your participation trophy is in the mail. *%s* won. 🏅",
  "History is written by the winners, and you are not in it. *%s* won. 📜",
  "We have reviewed your vote. We have concerns. *%s* won. 🔎",
  "At least you voted. That's genuinely the nicest thing we can say right now. *%s* won. 🕊️",
  "A moment of silence for your pick, which has been decisively rejected by your peers. *%s* won. 🪦",
  "Your taste has been evaluated by a panel of your coworkers and found lacking. *%s* won. 🧑‍⚖️",
  "The ghost of your choice will haunt the break room. *%s* won. 👻",
  "In an alternate universe your pick won. Unfortunately you live in this one. *%s* won. 🌍",
  "Your vote has been carefully considered and ceremonially thrown in the bin. *%s* won. 🗑️",
];

const TIE_MESSAGES = [
  "It's a tie! Democracy has collapsed. A runoff poll is being posted — go finish what you started. 🗳️",
  "Incredible. You and your coworkers managed to be equally wrong. A runoff has been posted. 🤝",
  "The people are divided. A runoff poll is live — please do better this time. ⚔️",
  "Your collective indecision has triggered a runoff. Congratulations on nothing. Go vote again. 🙃",
  "A tie has been detected. Scientists are baffled. A runoff poll awaits you. 🔬",
  "The algorithm is upset. There is a tie. A runoff is being posted. Fix this. 🤖",
  "History will record this as the day your office couldn't make up its mind. Runoff poll is up. 📜",
];

// Auto-generated — do not edit by hand.
// Regenerate: cd scripts && npm install && node generate-emoji-map.mjs
// node-emoji covers ~1800 emoji. This map patches only the cases where
// node-emoji's gemoji name differs from Slack's name.
const SLACK_OVERRIDES = {
  '🏊': 'swimmer',
  '🏃': 'runner',
  '🚴': 'bicyclist',
  '🏋️': 'weight_lifter',
  '🤺': 'fencer',
  '🏄': 'surfer',
  '🚵': 'mountain_bicyclist',
  '🚣': 'rowboat',
  '⛹️': 'basketball_player',
  // node-emoji has no entry for these — provide Slack names directly
  '🤸': 'person_doing_cartwheel',
  '🧘': 'person_in_lotus_position',
  '🧗': 'person_climbing',
  '🤼': 'wrestlers',
  '🤾': 'handball',
  '🤽': 'person_playing_water_polo',
  '🤹': 'juggling',
};

function unicodeToSlack(char) {
  const base = char.replace(/️$/u, ''); // strip variation selector-16
  return SLACK_OVERRIDES[char] ?? SLACK_OVERRIDES[base] ?? emojiWhich(char) ?? emojiWhich(base) ?? null;
}

// Normalises a poll display name to a filename-safe slug, e.g. "Summer Sports" → "summer-sports".
function slugify(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// Builds Block Kit blocks for a button-mode poll, reflecting current vote counts.
// counts: { [optionIndex]: voteCount }
function buildButtonPollBlocks(pollData, counts, slug) {
  const blocks = [];
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*📊 ${pollData.name}*` } });
  const preamble = pollData.preamble || 'Click a button to cast your vote:';
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `@channel: ${preamble}` } });
  for (let i = 0; i < pollData.options.length; i++) {
    const emoji = (pollData.emojis && pollData.emojis[i]) || NUMBER_EMOJIS[i] || 'question';
    const count = counts[i] || 0;
    const voteText = count === 1 ? '1 vote' : `${count} votes`;
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `    :${emoji}: ${pollData.options[i]}` },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: voteText },
        style: 'primary',
        action_id: 'poll_vote',
        value: `${slug}:${i}`,
      },
    });
  }
  if (pollData.description) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: pollData.description } });
  }
  blocks.push({
    type: 'context',
    block_id: 'poll_marker',
    elements: [{ type: 'mrkdwn', text: `poll_marker:${slug}` }],
  });
  return blocks;
}

async function postButtonPollResults(slug, pollData, channelId, userId, env) {
  const prefix = `votes:${slug}:${channelId}:`;
  const { keys } = await env.POLL_VOTES.list({ prefix });

  const allVotes = {};
  let messageTs = null;
  for (const key of keys) {
    const votes = (await env.POLL_VOTES.get(key.name, 'json')) || {};
    Object.assign(allVotes, votes);
    messageTs = key.name.substring(prefix.length);
  }

  const counts = {};
  for (const v of Object.values(allVotes)) counts[v] = (counts[v] || 0) + 1;

  // Build results array sorted by count descending (matches Go BuildResultsBlocks order)
  const results = pollData.options.map((label, i) => ({
    emoji: (pollData.emojis && pollData.emojis[i]) || NUMBER_EMOJIS[i] || 'question',
    label,
    count: counts[i] || 0,
  })).sort((a, b) => b.count - a.count);

  const maxCount = results[0].count;
  const winners = results.filter(r => r.count === maxCount).map(r => r.label);

  let summary;
  if (maxCount <= 0) {
    summary = '@channel: No votes have been cast yet.';
  } else if (winners.length === 1) {
    summary = `@channel: Top event: ${winners[0]}.`;
  } else {
    summary = `@channel: It's a tie between ${winners.join(' and ')}.`;
  }

  // Blocks matching Go's BuildResultsBlocks exactly
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: '📊 *Final Poll Results Are In!*' } },
    ...results.map(r => ({
      type: 'section',
      text: { type: 'mrkdwn', text: `    :${r.emoji}: ${r.label} — ${r.count} vote${r.count !== 1 ? 's' : ''}` },
    })),
    { type: 'section', text: { type: 'mrkdwn', text: summary } },
  ];

  // Fallback text matching Go's BuildResults format
  const fallbackLines = ['📊 *Final Poll Results Are In!*'];
  for (const r of results) {
    fallbackLines.push(`    :${r.emoji}: ${r.label} received ${r.count} votes`);
  }
  fallbackLines.push(summary.replace('@channel: ', ''));

  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: channelId, text: fallbackLines.join('\n'), blocks }),
  });

  if (messageTs) {
    await fetch('https://slack.com/api/chat.delete', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channelId, ts: messageTs }),
    });
  }

  if (maxCount > 0) {
    const isTie = winners.length > 1;
    const winnerLabel = winners.join(' and ');
    const winningLabels = new Set(winners);
    await Promise.allSettled(Object.entries(allVotes).map(async ([voterUserId, optionIndex]) => {
      const votedLabel = pollData.options[parseInt(optionIndex)];
      let msg;
      if (isTie) {
        msg = TIE_MESSAGES[Math.floor(Math.random() * TIE_MESSAGES.length)];
      } else if (winningLabels.has(votedLabel)) {
        msg = WINNER_MESSAGES[Math.floor(Math.random() * WINNER_MESSAGES.length)].replace('%s', winnerLabel);
      } else {
        msg = LOSER_MESSAGES[Math.floor(Math.random() * LOSER_MESSAGES.length)].replace('%s', winnerLabel);
      }
      await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: voterUserId, text: msg }),
      });
    }));
  }
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function ghHeaders(env) {
  return {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'slack-poll-bot',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function pollFileExists(slug, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/polls/${slug}.json`;
  const resp = await fetch(url, { headers: ghHeaders(env) });
  return resp.ok;
}

async function commitPollFile(slug, name, options, emojis, preamble, description, authorId, votingMode, schedule, resultsSchedule, channelId, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/polls/${slug}.json`;
  const pollData = { name, options, emojis, author_id: authorId };
  if (preamble) pollData.preamble = preamble;
  if (description) pollData.description = description;
  if (votingMode && votingMode !== 'reaction') pollData.voting_mode = votingMode;
  if (schedule) pollData.schedule = schedule.toLowerCase().trim();
  if (resultsSchedule) pollData.results_schedule = resultsSchedule.toLowerCase().trim();
  if (channelId) pollData.channel_id = channelId;
  const content = JSON.stringify(pollData, null, 2);
  const put = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Add poll: ${slug}`,
      content: toBase64(content),
      branch: 'main',
    }),
  });
  if (!put.ok) {
    const text = await put.text();
    throw new Error(`GitHub API ${put.status}: ${text}`);
  }
}

async function listPolls(env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/polls`;
  const resp = await fetch(url, { headers: ghHeaders(env) });
  if (resp.status === 404) return [];
  if (!resp.ok) return null; // error
  const files = await resp.json();
  return files
    .filter(f => f.type === 'file' && f.name.endsWith('.json'))
    .map(f => f.name.replace(/\.json$/, ''));
}

async function getPollData(slug, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/polls/${slug}.json`;
  const resp = await fetch(url, { headers: ghHeaders(env) });
  if (!resp.ok) return null;
  const file = await resp.json();
  return JSON.parse(atob(file.content.replace(/\n/g, '')));
}

async function deletePollFile(slug, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/polls/${slug}.json`;
  const getResp = await fetch(url, { headers: ghHeaders(env) });
  if (!getResp.ok) throw new Error(`Poll not found: ${slug}`);
  const { sha } = await getResp.json();
  const delResp = await fetch(url, {
    method: 'DELETE',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Delete poll: ${slug}`, sha, branch: 'main' }),
  });
  if (!delResp.ok) {
    const text = await delResp.text();
    throw new Error(`GitHub API ${delResp.status}: ${text}`);
  }
}

// ── Slack API helpers ─────────────────────────────────────────────────────────

function monthDayOrdinal(d) {
  const s = [11, 12, 13].includes(d) ? 'th' : d % 10 === 1 ? 'st' : d % 10 === 2 ? 'nd' : d % 10 === 3 ? 'rd' : 'th';
  return `${d}${s}`;
}

// buildScheduleFieldBlocks returns the input blocks for one schedule group.
// prefix: 'schedule' (post) or 'results'. freq: '' | 'daily' | 'weekly' | 'monthly'
function buildScheduleFieldBlocks(prefix, labelText, freq) {
  const blocks = [
    {
      type: 'input',
      block_id: `${prefix}_frequency`,
      label: { type: 'plain_text', text: labelText },
      optional: true,
      dispatch_action: true,
      element: {
        type: 'static_select',
        action_id: `${prefix}_frequency_select`,
        placeholder: { type: 'plain_text', text: 'No recurring schedule' },
        options: [
          { text: { type: 'plain_text', text: 'Daily' }, value: 'daily' },
          { text: { type: 'plain_text', text: 'Weekly' }, value: 'weekly' },
          { text: { type: 'plain_text', text: 'Monthly' }, value: 'monthly' },
        ],
      },
    },
  ];

  if (freq === 'weekly') {
    blocks.push({
      type: 'input',
      block_id: `${prefix}_days_of_week`,
      label: { type: 'plain_text', text: 'Days of Week' },
      optional: true,
      hint: { type: 'plain_text', text: 'Select which days to post.' },
      element: {
        type: 'checkboxes',
        action_id: 'value',
        options: [
          { text: { type: 'plain_text', text: 'Monday' }, value: 'monday' },
          { text: { type: 'plain_text', text: 'Tuesday' }, value: 'tuesday' },
          { text: { type: 'plain_text', text: 'Wednesday' }, value: 'wednesday' },
          { text: { type: 'plain_text', text: 'Thursday' }, value: 'thursday' },
          { text: { type: 'plain_text', text: 'Friday' }, value: 'friday' },
          { text: { type: 'plain_text', text: 'Saturday' }, value: 'saturday' },
          { text: { type: 'plain_text', text: 'Sunday' }, value: 'sunday' },
        ],
      },
    });
  }

  if (freq === 'monthly') {
    const dayOptions = [];
    for (let d = 1; d <= 28; d++) {
      dayOptions.push({ text: { type: 'plain_text', text: monthDayOrdinal(d) }, value: String(d) });
    }
    blocks.push({
      type: 'input',
      block_id: `${prefix}_day_of_month`,
      label: { type: 'plain_text', text: 'Days of Month' },
      optional: true,
      hint: { type: 'plain_text', text: 'Select which days of the month to post.' },
      element: {
        type: 'checkboxes',
        action_id: 'value',
        options: dayOptions,
      },
    });
  }

  if (freq) {
    blocks.push({
      type: 'input',
      block_id: `${prefix}_time`,
      label: { type: 'plain_text', text: 'Time (CT)' },
      optional: true,
      hint: { type: 'plain_text', text: 'Central Time. Note: there may be up to 3 hr delays depending on GitHub Actions traffic.' },
      element: {
        type: 'timepicker',
        action_id: 'value',
        placeholder: { type: 'plain_text', text: 'Select time' },
      },
    });
  }

  return blocks;
}

function buildCreatePollModal(channelId, userId, postFreq, resultsFreq) {
  return {
    type: 'modal',
    callback_id: 'create_poll',
    private_metadata: JSON.stringify({ channel_id: channelId, user_id: userId }),
    title: { type: 'plain_text', text: 'Create a Poll' },
    submit: { type: 'plain_text', text: 'Create' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'poll_name',
        label: { type: 'plain_text', text: 'Poll Name' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'e.g. Summer Sports' },
        },
      },
      {
        type: 'input',
        block_id: 'poll_preamble',
        label: { type: 'plain_text', text: 'Intro' },
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'What question are you asking? Shown above the options.\ne.g. "What should we do for the company outing?"' },
        },
      },
      {
        type: 'input',
        block_id: 'poll_options',
        label: { type: 'plain_text', text: 'Options (one per line, up to 9)' },
        hint: { type: 'plain_text', text: 'One option per line. Optionally prefix with a raw emoji (e.g. ⚽ Soccer) or a shortcode in colons (e.g. :name: Soccer) to set the reaction. Without a prefix, options are auto-numbered 1️⃣ 2️⃣ 3️⃣.' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          placeholder: { type: 'plain_text', text: '⚽ Soccer\n🏀 Basketball\nSwimming\nPickleball' },
        },
      },
      {
        type: 'input',
        block_id: 'poll_description',
        label: { type: 'plain_text', text: 'Description' },
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Add context or rules for voters — shown below the options in the poll.' },
        },
      },
      {
        type: 'input',
        block_id: 'voting_mode',
        label: { type: 'plain_text', text: 'Voting Method' },
        element: {
          type: 'radio_buttons',
          action_id: 'value',
          initial_option: { text: { type: 'plain_text', text: 'Reaction-based — voters react with emojis' }, value: 'reaction' },
          options: [
            {
              text: { type: 'plain_text', text: 'Reaction-based — voters react with emojis' },
              value: 'reaction',
            },
            {
              text: { type: 'plain_text', text: 'Button-based — voters click buttons, live counts shown' },
              value: 'button',
            },
          ],
        },
      },
      ...buildScheduleFieldBlocks('schedule', 'Post Schedule', postFreq),
      ...buildScheduleFieldBlocks('results', 'Results Schedule', resultsFreq),
    ],
  };
}

async function openModal(triggerId, channelId, userId, env) {
  const resp = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trigger_id: triggerId, view: buildCreatePollModal(channelId, userId, '', '') }),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`views.open failed: ${data.error}`);
}

async function openPostPollModal(triggerId, channelId, userId, polls, env) {
  const options = [
    { text: { type: 'plain_text', text: '🏃 Weekly Sports Poll' }, value: 'weekly' },
    ...polls.map(slug => ({
      text: { type: 'plain_text', text: slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') },
      value: slug,
    })),
  ];

  const modal = {
    type: 'modal',
    callback_id: 'post_poll',
    private_metadata: JSON.stringify({ channel_id: channelId, user_id: userId }),
    title: { type: 'plain_text', text: 'Post a Poll' },
    submit: { type: 'plain_text', text: 'Post' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'poll_select',
        label: { type: 'plain_text', text: 'Which poll would you like to post?' },
        element: {
          type: 'static_select',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Select a poll…' },
          options,
        },
      },
    ],
  };

  const resp = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trigger_id: triggerId, view: modal }),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`views.open failed: ${data.error}`);
}

async function openResultsModal(triggerId, channelId, userId, polls, env) {
  const options = [
    { text: { type: 'plain_text', text: '🏃 Weekly Sports Poll' }, value: 'weekly' },
    ...polls.map(slug => ({
      text: { type: 'plain_text', text: slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') },
      value: slug,
    })),
  ];

  const modal = {
    type: 'modal',
    callback_id: 'post_results',
    private_metadata: JSON.stringify({ channel_id: channelId, user_id: userId }),
    title: { type: 'plain_text', text: 'Post Results' },
    submit: { type: 'plain_text', text: 'Post Results' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'poll_select',
        label: { type: 'plain_text', text: 'Which poll are you posting results for?' },
        element: {
          type: 'static_select',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Select a poll…' },
          options,
        },
      },
    ],
  };

  const resp = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trigger_id: triggerId, view: modal }),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`views.open failed: ${data.error}`);
}

async function openRunoffModal(triggerId, channelId, userId, polls, env) {
  const options = [
    { text: { type: 'plain_text', text: '🏃 Weekly Sports Poll' }, value: 'weekly' },
    ...polls.map(slug => ({
      text: { type: 'plain_text', text: slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') },
      value: slug,
    })),
  ];

  const modal = {
    type: 'modal',
    callback_id: 'run_runoff',
    private_metadata: JSON.stringify({ channel_id: channelId, user_id: userId }),
    title: { type: 'plain_text', text: 'Run a Runoff' },
    submit: { type: 'plain_text', text: 'Run Runoff' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: 'This will check the selected poll for a tie and post a runoff if one is detected.' },
      },
      {
        type: 'input',
        block_id: 'poll_select',
        label: { type: 'plain_text', text: 'Which poll has a tie?' },
        element: {
          type: 'static_select',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Select a poll…' },
          options,
        },
      },
    ],
  };

  const resp = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trigger_id: triggerId, view: modal }),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`views.open failed: ${data.error}`);
}

async function openDeleteModal(triggerId, channelId, userId, polls, env) {
  const options = polls.map(slug => ({
    text: { type: 'plain_text', text: slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') },
    value: slug,
  }));

  const modal = {
    type: 'modal',
    callback_id: 'delete_poll',
    private_metadata: JSON.stringify({ channel_id: channelId, user_id: userId }),
    title: { type: 'plain_text', text: 'Delete a Poll' },
    submit: { type: 'plain_text', text: 'Continue' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: "You'll be asked to confirm before anything is deleted." },
      },
      {
        type: 'input',
        block_id: 'poll_select',
        label: { type: 'plain_text', text: 'Which poll would you like to delete?' },
        element: {
          type: 'static_select',
          action_id: 'value',
          placeholder: { type: 'plain_text', text: 'Select a poll…' },
          options,
        },
      },
    ],
  };

  const resp = await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trigger_id: triggerId, view: modal }),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`views.open failed: ${data.error}`);
}

async function sendDeleteConfirmationDM(userId, slug, pollName, env) {
  const resp = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel: userId,
      text: `Delete the "${pollName}" poll?`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🗑️ Are you sure you want to permanently delete the *${pollName}* poll? This cannot be undone.`,
          },
        },
        {
          type: 'actions',
          block_id: 'delete_confirm_actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Yes, Delete' },
              style: 'danger',
              action_id: 'delete_poll_confirm',
              value: slug,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Cancel' },
              action_id: 'delete_poll_cancel',
              value: slug,
            },
          ],
        },
      ],
    }),
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`chat.postMessage failed: ${data.error}`);
}

async function updateMessage(channelId, ts, text, env) {
  await fetch('https://slack.com/api/chat.update', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel: channelId, ts, text, blocks: [] }),
  });
}

async function postEphemeral(channelId, userId, text, env) {
  await fetch('https://slack.com/api/chat.postEphemeral', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel: channelId, user: userId, text }),
  });
}

// ── Response helpers ──────────────────────────────────────────────────────────

function ephemeral(text, status = 200) {
  return new Response(JSON.stringify({ response_type: 'ephemeral', text }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function modalError(blockId, message) {
  return new Response(
    JSON.stringify({ response_action: 'errors', errors: { [blockId]: message } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// ── Interaction handler (modal submissions) ───────────────────────────────────

async function handleInteraction(request, env) {
  const body = await request.text();

  if (!await verifySlackSignature(request, body, env.SLACK_SIGNING_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const params = new URLSearchParams(body);
  const payload = JSON.parse(params.get('payload') || '{}');

  // ── block_actions: button clicks (e.g. delete confirmation DM) ──────────────
  if (payload.type === 'block_actions') {
    const action = payload.actions?.[0];
    const channelId = payload.channel?.id;
    const messageTs = payload.message?.ts;

    if (action?.action_id === 'delete_poll_confirm') {
      const slug = action.value;
      const work = async () => {
        try {
          await deletePollFile(slug, env);
          await updateMessage(channelId, messageTs, `✅ Poll *${slug}* has been permanently deleted.`, env);
        } catch (e) {
          console.error('delete_poll_confirm error:', e);
          await updateMessage(channelId, messageTs, `❌ Failed to delete poll: ${e.message}`, env);
        }
      };
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    } else if (action?.action_id === 'delete_poll_cancel') {
      const slug = action.value;
      const work = async () => {
        await updateMessage(channelId, messageTs, `Deletion of *${slug}* cancelled.`, env);
      };
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    } else if (action?.action_id === 'schedule_frequency_select') {
      const selectedFreq = action.selected_option?.value || '';
      const currentResultsFreq = payload.view?.state?.values?.results_frequency?.results_frequency_select?.selected_option?.value || '';
      const viewId = payload.view?.id;
      let viewMeta = {};
      try { viewMeta = JSON.parse(payload.view?.private_metadata || '{}'); } catch {}
      const work = async () => {
        await fetch('https://slack.com/api/views.update', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            view_id: viewId,
            view: buildCreatePollModal(viewMeta.channel_id || '', viewMeta.user_id || '', selectedFreq, currentResultsFreq),
          }),
        });
      };
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    } else if (action?.action_id === 'results_frequency_select') {
      const selectedResultsFreq = action.selected_option?.value || '';
      const currentPostFreq = payload.view?.state?.values?.schedule_frequency?.schedule_frequency_select?.selected_option?.value || '';
      const viewId = payload.view?.id;
      let viewMeta = {};
      try { viewMeta = JSON.parse(payload.view?.private_metadata || '{}'); } catch {}
      const work = async () => {
        await fetch('https://slack.com/api/views.update', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            view_id: viewId,
            view: buildCreatePollModal(viewMeta.channel_id || '', viewMeta.user_id || '', currentPostFreq, selectedResultsFreq),
          }),
        });
      };
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    } else if (action?.action_id === 'poll_vote') {
      const [slug, optIdxStr] = action.value.split(':');
      const optIdx = parseInt(optIdxStr, 10);
      const userId = payload.user?.id;

      const work = async () => {
        try {
          const pollData = await getPollData(slug, env);
          if (!pollData) { console.error('poll_vote: poll not found:', slug); return; }

          const kvKey = `votes:${slug}:${channelId}:${messageTs}`;
          const existing = (await env.POLL_VOTES.get(kvKey, 'json')) || {};

          if (existing[userId] === optIdx) {
            delete existing[userId]; // toggle off
          } else {
            existing[userId] = optIdx; // set or change vote
          }
          await env.POLL_VOTES.put(kvKey, JSON.stringify(existing));

          const counts = {};
          for (const v of Object.values(existing)) counts[v] = (counts[v] || 0) + 1;

          const blocks = buildButtonPollBlocks(pollData, counts, slug);
          await fetch('https://slack.com/api/chat.update', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel: channelId, ts: messageTs, text: `📊 ${pollData.name}`, blocks }),
          });
        } catch (e) {
          console.error('poll_vote error:', e);
        }
      };
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    }

    return new Response('', { status: 200 });
  }

  if (payload.type !== 'view_submission') return new Response('', { status: 200 });

  const callbackId = payload.view?.callback_id;
  let meta = {};
  try { meta = JSON.parse(payload.view.private_metadata || '{}'); } catch {}

  // ── post_poll: user selected a poll to post ───────────────────────────────
  if (callbackId === 'post_poll') {
    const selected = payload.view.state.values.poll_select?.value?.selected_option?.value || '';
    const inputs = { channel_id: meta.channel_id || '' };
    if (selected && selected !== 'weekly') inputs.poll_name = selected;

    const dispatchPromise = triggerWorkflow('post_poll.yml', env, inputs)
      .then(() => {
        if (meta.channel_id && meta.user_id) {
          const label = selected === 'weekly' ? 'Weekly Sports Poll' : selected;
          return postEphemeral(meta.channel_id, meta.user_id, `📊 *${label}* is being posted to the channel!`, env);
        }
      })
      .catch(err => {
        console.error('post_poll dispatch error:', err);
        if (meta.channel_id && meta.user_id) {
          return postEphemeral(meta.channel_id, meta.user_id, '❌ Failed to post poll. Please try again.', env);
        }
      });

    if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(dispatchPromise);
    return new Response('', { status: 200 });
  }

  // ── post_results: user selected a poll to post results for ───────────────
  if (callbackId === 'post_results') {
    const selected = payload.view.state.values.poll_select?.value?.selected_option?.value || '';
    const channelId = meta.channel_id || '';
    const userId = meta.user_id || '';

    const work = async () => {
      try {
        if (selected && selected !== 'weekly') {
          const pollData = await getPollData(selected, env);
          if (pollData?.voting_mode === 'button') {
            await postButtonPollResults(selected, pollData, channelId, userId, env);
            return;
          }
        }
        await triggerWorkflow('post_results.yml', env, { channel_id: channelId });
        if (channelId && userId) {
          await postEphemeral(channelId, userId, '📊 Results are being computed and will be posted shortly. The poll will be removed once done.', env);
        }
      } catch (err) {
        console.error('post_results error:', err);
        if (channelId && userId) {
          await postEphemeral(channelId, userId, '❌ Failed to post results. Please try again.', env);
        }
      }
    };
    if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    return new Response('', { status: 200 });
  }

  // ── delete_poll: user selected a poll to delete ──────────────────────────
  if (callbackId === 'delete_poll') {
    const selected = payload.view.state.values.poll_select?.value?.selected_option?.value || '';
    const userId = payload.user?.id;

    const work = async () => {
      try {
        const pollData = await getPollData(selected, env);
        if (!pollData) {
          await postEphemeral(meta.channel_id, userId, `❌ Poll \`${selected}\` not found.`, env);
          return;
        }
        if (pollData.author_id && pollData.author_id !== userId && userId !== env.ADMIN_USER_ID) {
          await postEphemeral(meta.channel_id, userId, `❌ Only the poll author can delete it.`, env);
          return;
        }
        await sendDeleteConfirmationDM(userId, selected, pollData.name, env);
      } catch (e) {
        console.error('delete_poll flow error:', e);
        await postEphemeral(meta.channel_id, userId, '❌ Failed to process deletion. Please try again.', env);
      }
    };
    if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    return new Response('', { status: 200 });
  }

  // ── run_runoff: user selected a poll to run a runoff for ────────────────
  if (callbackId === 'run_runoff') {
    const selected = payload.view.state.values.poll_select?.value?.selected_option?.value || '';
    const inputs = { channel_id: meta.channel_id || '' };
    if (selected && selected !== 'weekly') inputs.poll_name = selected;

    const dispatchPromise = triggerWorkflow('runoff.yml', env, inputs)
      .then(() => {
        if (meta.channel_id && meta.user_id) {
          return postEphemeral(meta.channel_id, meta.user_id, '🗳️ Checking for ties and posting a runoff poll if needed. Check the channel shortly.', env);
        }
      })
      .catch(err => {
        console.error('run_runoff dispatch error:', err);
        if (meta.channel_id && meta.user_id) {
          return postEphemeral(meta.channel_id, meta.user_id, '❌ Failed to trigger runoff. Please try again.', env);
        }
      });

    if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(dispatchPromise);
    return new Response('', { status: 200 });
  }

  // ── create_poll: user submitted a new poll form ───────────────────────────
  if (callbackId !== 'create_poll') return new Response('', { status: 200 });

  const values = payload.view.state.values;
  const nameRaw = values.poll_name?.value?.value?.trim() || '';
  const preambleRaw = values.poll_preamble?.value?.value?.trim() || '';
  const optionsRaw = values.poll_options?.value?.value?.trim() || '';
  const descriptionRaw = values.poll_description?.value?.value?.trim() || '';
  const votingModeRaw = values.voting_mode?.value?.selected_option?.value || 'reaction';
  const scheduleFreq = values.schedule_frequency?.schedule_frequency_select?.selected_option?.value || '';
  const scheduleDaysOfWeek = (values.schedule_days_of_week?.value?.selected_options || []).map(o => o.value);
  const scheduleDaysOfMonth = (values.schedule_day_of_month?.value?.selected_options || []).map(o => o.value);
  const scheduleTime = values.schedule_time?.value?.value || '';

  if (!nameRaw) return modalError('poll_name', 'Poll name is required.');

  let scheduleRaw = '';
  if (scheduleFreq) {
    if (!scheduleTime) return modalError('schedule_time', 'Please select a time for the schedule.');
    if (scheduleFreq === 'weekly' && scheduleDaysOfWeek.length === 0) {
      return modalError('schedule_days_of_week', 'Please select at least one day for a weekly schedule.');
    }
    if (scheduleFreq === 'monthly' && scheduleDaysOfMonth.length === 0) {
      return modalError('schedule_day_of_month', 'Please select at least one day of the month for a monthly schedule.');
    }
    if (scheduleFreq === 'daily') {
      scheduleRaw = `daily ${scheduleTime}`;
    } else if (scheduleFreq === 'weekly') {
      scheduleRaw = `${scheduleDaysOfWeek.join(' ')} ${scheduleTime}`;
    } else if (scheduleFreq === 'monthly') {
      scheduleRaw = `monthly ${scheduleDaysOfMonth.join(' ')} ${scheduleTime}`;
    }
  }

  const resultsFreq = values.results_frequency?.results_frequency_select?.selected_option?.value || '';
  const resultsDaysOfWeek = (values.results_days_of_week?.value?.selected_options || []).map(o => o.value);
  const resultsDaysOfMonth = (values.results_day_of_month?.value?.selected_options || []).map(o => o.value);
  const resultsTime = values.results_time?.value?.value || '';

  let resultsScheduleRaw = '';
  if (resultsFreq) {
    if (!resultsTime) return modalError('results_time', 'Please select a time for the results schedule.');
    if (resultsFreq === 'weekly' && resultsDaysOfWeek.length === 0) {
      return modalError('results_days_of_week', 'Please select at least one day for a weekly results schedule.');
    }
    if (resultsFreq === 'monthly' && resultsDaysOfMonth.length === 0) {
      return modalError('results_day_of_month', 'Please select at least one day of the month for a monthly results schedule.');
    }
    if (resultsFreq === 'daily') {
      resultsScheduleRaw = `daily ${resultsTime}`;
    } else if (resultsFreq === 'weekly') {
      resultsScheduleRaw = `${resultsDaysOfWeek.join(' ')} ${resultsTime}`;
    } else if (resultsFreq === 'monthly') {
      resultsScheduleRaw = `monthly ${resultsDaysOfMonth.join(' ')} ${resultsTime}`;
    }
  }

  const options = [];
  const emojis = [];
  for (const line of optionsRaw.split('\n').map(l => l.trim()).filter(Boolean)) {
    // :emoji_name: Label
    const namedMatch = line.match(/^:([a-z0-9_+\-]+):\s*(.+)$/);
    if (namedMatch) {
      emojis.push(namedMatch[1]);
      options.push(namedMatch[2].trim());
      continue;
    }
    // Raw unicode emoji + Label (e.g. "⚽ Soccer" or "😊 Happy")
    const unicodeMatch = line.match(/^(\p{Extended_Pictographic}️?)\s+(.+)$/u);
    if (unicodeMatch) {
      const name = unicodeToSlack(unicodeMatch[1]);
      emojis.push(name || NUMBER_EMOJIS[options.length] || 'question');
      options.push(unicodeMatch[2].trim());
      continue;
    }
    // No emoji prefix — numbered fallback
    emojis.push(NUMBER_EMOJIS[options.length] || 'question');
    options.push(line);
  }

  if (options.length < 2) return modalError('poll_options', 'Please enter at least 2 options.');
  if (options.length > 9) return modalError('poll_options', 'Maximum 9 options allowed.');

  const slug = slugify(nameRaw);
  if (!slug) return modalError('poll_name', 'Poll name must contain at least one letter or number.');

  if (await pollFileExists(slug, env)) {
    return modalError('poll_name', `A poll named "${nameRaw}" already exists. Choose a different name.`);
  }

  const commitPromise = commitPollFile(slug, nameRaw, options, emojis, preambleRaw, descriptionRaw, payload.user?.id, votingModeRaw, scheduleRaw, resultsScheduleRaw, meta.channel_id || '', env)
    .then(() => {
      if (meta.channel_id && meta.user_id) {
        return postEphemeral(
          meta.channel_id,
          meta.user_id,
          `✅ Poll *${nameRaw}* saved! It will appear in \`/newpoll\` next time.`,
          env,
        );
      }
    })
    .catch(err => {
      console.error('commitPollFile error:', err);
      if (meta.channel_id && meta.user_id) {
        return postEphemeral(meta.channel_id, meta.user_id, '❌ Failed to save poll. Please try again.', env);
      }
    });

  if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(commitPromise);

  // Returning empty 200 closes the modal immediately.
  return new Response('', { status: 200 });
}

// ── Slash command handler ─────────────────────────────────────────────────────

async function handleSlashCommand(request, env) {
  const body = await request.text();

  if (!await verifySlackSignature(request, body, env.SLACK_SIGNING_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const params = new URLSearchParams(body);
  const command = params.get('command');
  const channelId = params.get('channel_id') || '';
  const userId = params.get('user_id') || '';
  const triggerId = params.get('trigger_id') || '';
  const text = (params.get('text') || '').trim();

  switch (command) {
    case '/help':
      return ephemeral(HELP_TEXT);

    case '/vote':
      return ephemeral([
        '🗳️ *How to Vote (Yes, We Know You Need This Explained)*',
        '',
        "Voting is done via emoji reactions. It is, objectively, the simplest possible interaction a human can perform — and yet, here we are.",
        '',
        '*Step 1:* Find the poll in the channel. It\'s the big block of text that starts with 📊. You\'ve probably scrolled past it already.',
        '',
        '*Step 2:* Hover over the poll message and click the emoji button (the little 🙂 that appears on the right). On mobile, long-press the message like you\'re trying to intimidate it.',
        '',
        '*Step 3:* Find and select the emoji that matches your choice. For the weekly poll, your options are:',
        POLL_OPTIONS_TEXT,
        '',
        'For custom polls, the options are numbered — use 1️⃣ 2️⃣ 3️⃣ etc., exactly as shown in the poll message. The labels are right there. Read them.',
        '',
        '*Step 4:* That\'s it. You\'re done. There is no step 5. Please rejoin society.',
        '',
        '_One reaction per option. Voting for everything is not a strategy, it\'s a cry for help. Use `/results` to watch your pick lose in real time._',
      ].join('\n'));

    case '/results': {
      const resultsWork = async () => {
        try {
          const polls = await listPolls(env) || [];
          await openResultsModal(triggerId, channelId, userId, polls, env);
        } catch (e) {
          console.error('results modal error:', e);
          await postEphemeral(channelId, userId, '❌ Failed to open results selector. Please try again.', env);
        }
      };
      const rp = resultsWork();
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(rp);
      return new Response('', { status: 200 });
    }

    case '/newpoll': {
      const newpollWork = async () => {
        try {
          const polls = await listPolls(env) || [];
          await openPostPollModal(triggerId, channelId, userId, polls, env);
        } catch (e) {
          console.error('newpoll modal error:', e);
          await postEphemeral(channelId, userId, '❌ Failed to open poll selector. Please try again.', env);
        }
      };
      const np = newpollWork();
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(np);
      return new Response('', { status: 200 });
    }

    case '/runoff': {
      const runoffWork = async () => {
        try {
          const polls = await listPolls(env) || [];
          await openRunoffModal(triggerId, channelId, userId, polls, env);
        } catch (e) {
          console.error('runoff modal error:', e);
          await postEphemeral(channelId, userId, '❌ Failed to open runoff selector. Please try again.', env);
        }
      };
      const rof = runoffWork();
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(rof);
      return new Response('', { status: 200 });
    }

    case '/delete': {
      const deleteWork = async () => {
        try {
          const polls = await listPolls(env) || [];
          if (polls.length === 0) {
            await postEphemeral(channelId, userId, 'No custom polls to delete. Use `/create` to make one.', env);
            return;
          }
          await openDeleteModal(triggerId, channelId, userId, polls, env);
        } catch (e) {
          console.error('delete modal error:', e);
          await postEphemeral(channelId, userId, '❌ Failed to open delete selector. Please try again.', env);
        }
      };
      const dp = deleteWork();
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(dp);
      return new Response('', { status: 200 });
    }

    case '/create': {
      const createWork = async () => {
        try {
          await openModal(triggerId, channelId, userId, env);
        } catch (e) {
          console.error('modal open error:', e);
          await postEphemeral(channelId, userId, '❌ Failed to open poll creation form. Please try again.', env);
        }
      };
      const cp = createWork();
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(cp);
      return new Response('', { status: 200 });
    }

    case '/polls': {
      try {
        const polls = await listPolls(env);
        if (polls === null) return ephemeral('Failed to fetch polls. Please try again.');
        const lines = ['• `weekly` — 🏃 Weekly Sports Poll', ...polls.map(p => `• \`${p}\``)];
        return ephemeral(`📋 *Available Polls*\n\n${lines.join('\n')}\n\nUse \`/newpoll\` to post one or \`/create\` to add a custom poll.`);
      } catch (e) {
        console.error('polls list error:', e);
        return ephemeral('Failed to fetch polls. Please try again.');
      }
    }

    case '/schedule': {
      const schedWork = async () => {
        try {
          const text = await buildScheduleText(env);
          await postEphemeral(channelId, userId, text, env);
        } catch (e) {
          console.error('schedule error:', e);
          await postEphemeral(channelId, userId, '❌ Failed to fetch schedule. Please try again.', env);
        }
      };
      const sp = schedWork();
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(sp);
      return new Response('', { status: 200 });
    }

    case '/about':
      return ephemeral(ABOUT_TEXT);

    case '/ping':
      return ephemeral('pong 🏓');

    default:
      return ephemeral('Unsupported slash command. Use /help to see available commands.');
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    env._ctx = ctx; // expose waitUntil for the interaction handler
    const { pathname } = new URL(request.url);

    if (request.method === 'POST') {
      if (pathname === '/slack/commands') return handleSlashCommand(request, env);
      if (pathname === '/slack/interactions') return handleInteraction(request, env);
    }
    return new Response('Not found', { status: 404 });
  },

};

// Named exports for unit testing — Cloudflare Workers ignore these; only the default export matters.
export { formatSchedule, buildButtonPollBlocks, slugify };
