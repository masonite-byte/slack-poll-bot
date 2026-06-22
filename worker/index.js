import { which as emojiWhich, get as emojiGet } from 'node-emoji';

const HELP_TEXT = [
  'Supported slash commands:',
  '/results   - show the current poll results.',
  '/newpoll   - pick and post a poll from a dropdown.',
  '/runoff    - start a runoff poll when tied.',
  '/delete    - permanently delete a custom poll (authors only).',
  '/create    - create a custom poll via a form.',
  '/edit      - edit an existing custom poll (authors and admin only).',
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

function titleizeSlug(slug) {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function buildPollChoice(slug, pollData) {
  return {
    slug,
    label: pollData?.name || titleizeSlug(slug),
    data: pollData || null,
  };
}

async function listPollChoices(env) {
  const slugs = await listPolls(env);
  if (slugs === null) return null;
  const choices = await Promise.all(slugs.map(async (slug) => {
    try {
      return buildPollChoice(slug, await getPollData(slug, env));
    } catch (e) {
      console.error('listPollChoices: failed to fetch poll data', slug, e);
      return buildPollChoice(slug, null);
    }
  }));
  choices.sort((a, b) => {
    if (a.slug === 'weekly') return -1;
    if (b.slug === 'weekly') return 1;
    return a.label.localeCompare(b.label);
  });
  return choices;
}

function formatPollOptionsText(pollData) {
  if (!pollData?.options?.length) return POLL_OPTIONS_TEXT;
  return pollData.options.map((option, index) => {
    const emoji = pollData.emojis?.[index] || NUMBER_EMOJIS[index] || 'question';
    return `:${emoji}: ${option}`;
  }).join('\n');
}

// buildScheduleText fetches stored polls with schedules and builds the /schedule response.
async function buildScheduleText(env) {
  const lines = [
    '📅 *Poll Schedule*',
  ];

  const choices = await listPollChoices(env);
  if (choices === null) throw new Error('failed to list polls');

  const weekly = choices.find(choice => choice.slug === 'weekly');
  if (weekly?.data) {
    lines.push('', `*${weekly.label}*`);
    if (weekly.data.schedule) {
      lines.push(`• Post: ${formatSchedule(weekly.data.schedule)}`);
    }
    if (weekly.data.results_schedule) {
      lines.push(`• Results: ${formatSchedule(weekly.data.results_schedule)}`);
    }
  }

  const customLines = [];
  try {
    for (const choice of choices) {
      if (choice.slug === 'weekly' || !choice.data?.schedule) continue;
      customLines.push(`• *${choice.label}* — ${formatSchedule(choice.data.schedule)}`);
      if (choice.data.results_schedule) {
        customLines.push(`  ↳ Results: ${formatSchedule(choice.data.results_schedule)}`);
      }
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
  // node-emoji uses a different name than Slack
  '🤖': 'robot_face',
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

// Formats one poll option for Slack mrkdwn with NBSP leading indent and hanging-indent
// pre-wrap for long text so continuation lines don't fall back to the left margin.
function optionLine(emoji, text) {
  const nbsp = ' ';
  const leading = nbsp.repeat(4);
  const cont = nbsp.repeat(11); // 4 leading + ~6 emoji visual width + 1 space
  const prefix = `${leading}:${emoji}: `;
  const wrapAt = 30;
  if ([...text].length <= wrapAt) return prefix + text;
  const words = text.split(/\s+/).filter(Boolean);
  let result = prefix;
  let col = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const wlen = [...w].length;
    if (i === 0) { result += w; col = wlen; }
    else if (col + 1 + wlen > wrapAt) { result += '\n' + cont + w; col = wlen; }
    else { result += ' ' + w; col += 1 + wlen; }
  }
  return result;
}

// Normalises a poll display name to a filename-safe slug, e.g. "Summer Sports" → "summer-sports".
function slugify(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// Builds Block Kit blocks for a button-mode poll, reflecting current vote counts.
// counts: { [optionIndex]: voteCount }
// voters: { [optionIndex]: userId[] } — only used when pollData.anonymous === false
function buildButtonPollBlocks(pollData, counts, slug, voters = {}) {
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
      text: { type: 'mrkdwn', text: optionLine(emoji, pollData.options[i]) },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: voteText },
        style: 'primary',
        action_id: 'poll_vote',
        value: `${slug}:${i}`,
      },
    });
    if (pollData.anonymous === false && voters[i] && voters[i].length > 0) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `👥 ${voters[i].map(uid => `<@${uid}>`).join(' ')}` }],
      });
    }
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

async function postReactionRunoff(winners, pollData, channelId, env) {
  const emojiMap = {};
  if (pollData.emojis) {
    pollData.options.forEach((opt, i) => { emojiMap[opt] = pollData.emojis[i]; });
  }
  const resolveEmoji = (label) => emojiMap[label] || label.toLowerCase().replace(/\s+/g, '_');

  const optionLines = winners.map(w => `    :${resolveEmoji(w)}: ${w}`);
  const fallback = [
    '📊 *Runoff Poll*',
    '@channel: A tie was detected. Vote again for the final winner:',
    ...optionLines,
  ].join('\n');

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: '*📊 Runoff Poll*' } },
    { type: 'section', text: { type: 'mrkdwn', text: '@channel: A tie was detected. Vote again for the final winner:' } },
    ...winners.map(w => ({ type: 'section', text: { type: 'mrkdwn', text: `    :${resolveEmoji(w)}: ${w}` } })),
    { type: 'context', block_id: 'poll_marker', elements: [{ type: 'mrkdwn', text: 'poll_marker:runoff' }] },
  ];

  const postResp = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: channelId, text: fallback, blocks }),
  });
  const posted = await postResp.json();
  if (!posted.ok) {
    console.error('Failed to post runoff poll:', posted.error);
    return;
  }
  const ts = posted.ts;
  for (const w of winners) {
    await fetch('https://slack.com/api/reactions.add', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channelId, timestamp: ts, name: resolveEmoji(w) }),
    });
  }
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
    { type: 'context', block_id: 'results_marker', elements: [{ type: 'mrkdwn', text: `results_marker:${slug}` }] },
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

  // Admin voter summary DM
  if (env.ADMIN_USER_ID) {
    const byOption = {};
    for (const [uid, optIdx] of Object.entries(allVotes)) {
      if (!byOption[optIdx]) byOption[optIdx] = [];
      byOption[optIdx].push(uid);
    }
    const adminLines = [`📊 *Admin Voter Summary: ${pollData.name}*`];
    for (let i = 0; i < pollData.options.length; i++) {
      const emoji = (pollData.emojis && pollData.emojis[i]) || NUMBER_EMOJIS[i] || 'question';
      const voters = byOption[i] || [];
      adminLines.push(`\n:${emoji}: *${pollData.options[i]}* (${voters.length} vote${voters.length === 1 ? '' : 's'})`);
      if (voters.length === 0) adminLines.push('  _No votes_');
      for (const uid of voters) adminLines.push(`  • <@${uid}>`);
    }
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: env.ADMIN_USER_ID, text: adminLines.join('\n') }),
    });
  }

  if (maxCount > 0) {
    const isTie = winners.length > 1;
    const winnerLabel = winners.join(' and ');
    const winningLabels = new Set(winners);

    if (!isTie) {
      updateWinnerState(slug, winners[0], env).catch(e => console.error('updateWinnerState:', e));
    }

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

    if (isTie) {
      await postReactionRunoff(winners, pollData, channelId, env);
    }
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

async function commitPollFile(slug, name, options, emojis, preamble, description, authorId, votingMode, schedule, resultsSchedule, channelId, anonymous, excludePreviousWinner, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/polls/${slug}.json`;
  const pollData = { name, options, emojis, author_id: authorId };
  if (preamble) pollData.preamble = preamble;
  if (description) pollData.description = description;
  if (votingMode && votingMode !== 'reaction') pollData.voting_mode = votingMode;
  if (votingMode === 'button' && anonymous === false) pollData.anonymous = false;
  if (excludePreviousWinner) pollData.exclude_previous_winner = true;
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
    .filter(f => f.type === 'file' && f.name.endsWith('.json') && !f.name.startsWith('_'))
    .map(f => f.name.replace(/\.json$/, ''));
}

async function getPollData(slug, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/polls/${slug}.json`;
  const resp = await fetch(url, { headers: ghHeaders(env) });
  if (!resp.ok) return null;
  const file = await resp.json();
  const binary = atob(file.content.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
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

async function updateWinnerState(slug, winner, env) {
  const path = 'polls/_winner_state.json';
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
  const getResp = await fetch(url, { headers: ghHeaders(env) });
  let state = {};
  let sha = null;
  if (getResp.ok) {
    const file = await getResp.json();
    sha = file.sha;
    const binary = atob(file.content.replace(/\n/g, ''));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    state = JSON.parse(new TextDecoder().decode(bytes));
  }
  state[slug] = winner;
  const body = {
    message: `chore: update winner state for ${slug} [skip ci]`,
    content: toBase64(JSON.stringify(state, null, 2) + '\n'),
    committer: { name: 'Poll-inator', email: 'pollinator@noreply.github.com' },
    branch: 'main',
  };
  if (sha) body.sha = sha;
  const putResp = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!putResp.ok) {
    const text = await putResp.text();
    console.error(`Failed to update winner state for ${slug}: ${putResp.status}: ${text}`);
  }
}

// ── Slack API helpers ─────────────────────────────────────────────────────────

function monthDayOrdinal(d) {
  const s = [11, 12, 13].includes(d) ? 'th' : d % 10 === 1 ? 'st' : d % 10 === 2 ? 'nd' : d % 10 === 3 ? 'rd' : 'th';
  return `${d}${s}`;
}

// buildScheduleFieldBlocks returns the input blocks for one schedule group.
// prefix: 'schedule' (post) or 'results'. freq: '' | 'daily' | 'weekly' | 'monthly'
// initialTime/initialDays: previously-selected values to restore on rebuild.
function buildScheduleFieldBlocks(prefix, labelText, freq, initialTime = '', initialDays = []) {
  const weekdayLabels = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday' };
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
        ...(freq ? { initial_option: { text: { type: 'plain_text', text: freq.charAt(0).toUpperCase() + freq.slice(1) }, value: freq } } : {}),
        options: [
          { text: { type: 'plain_text', text: 'Daily' }, value: 'daily' },
          { text: { type: 'plain_text', text: 'Weekly' }, value: 'weekly' },
          { text: { type: 'plain_text', text: 'Monthly' }, value: 'monthly' },
        ],
      },
    },
  ];

  if (freq === 'weekly') {
    const validDays = initialDays.filter(d => weekdayLabels[d]);
    const restoredOptions = validDays.map(d => ({ text: { type: 'plain_text', text: weekdayLabels[d] }, value: d }));
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
        initial_options: restoredOptions.length > 0
          ? restoredOptions
          : [{ text: { type: 'plain_text', text: 'Monday' }, value: 'monday' }],
      },
    });
  }

  if (freq === 'monthly') {
    const dayOptions = [];
    for (let d = 1; d <= 28; d++) {
      dayOptions.push({ text: { type: 'plain_text', text: monthDayOrdinal(d) }, value: String(d) });
    }
    const validMonthDays = initialDays.filter(d => Number(d) >= 1 && Number(d) <= 28);
    const restoredMonthOptions = validMonthDays.map(d => ({ text: { type: 'plain_text', text: monthDayOrdinal(Number(d)) }, value: String(d) }));
    blocks.push({
      type: 'input',
      block_id: `${prefix}_day_of_month`,
      label: { type: 'plain_text', text: 'Days of Month' },
      optional: true,
      hint: { type: 'plain_text', text: 'Select which days of the month to post.' },
      element: {
        type: 'multi_static_select',
        action_id: 'value',
        placeholder: { type: 'plain_text', text: 'Select days' },
        options: dayOptions,
        initial_options: restoredMonthOptions.length > 0
          ? restoredMonthOptions
          : [{ text: { type: 'plain_text', text: monthDayOrdinal(1) }, value: '1' }],
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
        initial_time: initialTime || '09:00',
      },
    });
  }

  return blocks;
}

// postState/resultsState: { freq, days, time } objects to restore schedule UI on dispatch rebuild.
function buildCreatePollModal(channelId, userId, postFreq, resultsFreq, votingMode = '', postState = {}, resultsState = {}) {
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
        dispatch_action: true,
        element: {
          type: 'radio_buttons',
          action_id: 'voting_mode_select',
          initial_option: votingMode === 'button'
            ? { text: { type: 'plain_text', text: 'Button-based — voters click buttons, live counts shown' }, value: 'button' }
            : { text: { type: 'plain_text', text: 'Reaction-based — voters react with emojis' }, value: 'reaction' },
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
      ...(votingMode === 'button' ? [{
        type: 'input',
        block_id: 'show_voters',
        label: { type: 'plain_text', text: 'Voter Visibility' },
        optional: true,
        element: {
          type: 'checkboxes',
          action_id: 'value',
          options: [{ text: { type: 'plain_text', text: 'Show who voted under each option' }, value: 'show' }],
          initial_options: [{ text: { type: 'plain_text', text: 'Show who voted under each option' }, value: 'show' }],
        },
      }] : []),
      {
        type: 'input',
        block_id: 'exclude_previous_winner',
        label: { type: 'plain_text', text: 'Previous Winner Exclusion' },
        optional: true,
        element: {
          type: 'checkboxes',
          action_id: 'value',
          options: [{
            text: { type: 'plain_text', text: 'Exclude the previous posted winner the next time this poll is posted' },
            value: 'exclude',
          }],
        },
      },
      ...buildScheduleFieldBlocks('schedule', 'Post Schedule', postFreq, postState.time, postState.days),
      ...buildScheduleFieldBlocks('results', 'Results Schedule', resultsFreq, resultsState.time, resultsState.days),
    ],
  };
}

// ── Poll editing helpers ──────────────────────────────────────────────────────

// Parses a stored schedule string back into form field values.
function parseSchedule(str) {
  if (!str) return { freq: '', days: [], time: '' };
  const parts = str.trim().toLowerCase().split(/\s+/);
  if (parts[0] === 'daily') return { freq: 'daily', days: [], time: parts[1] || '' };
  if (parts[0] === 'monthly') {
    const timeIdx = parts.findIndex((p, i) => i > 0 && /^\d{1,2}:\d{2}$/.test(p));
    return { freq: 'monthly', days: parts.slice(1, timeIdx < 0 ? undefined : timeIdx), time: timeIdx >= 0 ? parts[timeIdx] : '' };
  }
  const weekdays = new Set(['monday','tuesday','wednesday','thursday','friday','saturday','sunday']);
  const timeIdx = parts.findIndex(p => /^\d{1,2}:\d{2}$/.test(p));
  if (timeIdx >= 0 && weekdays.has(parts[0])) {
    return { freq: 'weekly', days: parts.slice(0, timeIdx), time: parts[timeIdx] };
  }
  return { freq: '', days: [], time: '' };
}

function readEditScheduleState(values, prefix, freqOverride = null) {
  const normalizedPrefix = `edit_${prefix}`;
  const selectedFreq = freqOverride
    ?? values?.[`${normalizedPrefix}_frequency`]?.[`${normalizedPrefix}_frequency_select`]?.selected_option?.value
    ?? '';
  const freq = selectedFreq === 'none' ? '' : selectedFreq;
  if (!freq) return { freq: '', days: [], time: '' };

  const time = values?.[`${normalizedPrefix}_time`]?.value?.selected_time || '';
  if (freq === 'weekly') {
    return {
      freq,
      days: (values?.[`${normalizedPrefix}_days_of_week`]?.value?.selected_options || []).map(o => o.value),
      time,
    };
  }
  if (freq === 'monthly') {
    return {
      freq,
      days: (values?.[`${normalizedPrefix}_day_of_month`]?.value?.selected_options || []).map(o => o.value),
      time,
    };
  }
  return { freq, days: [], time };
}

function readCreateScheduleState(values, prefix, freqOverride = null) {
  const selectedFreq = freqOverride
    ?? values?.[`${prefix}_frequency`]?.[`${prefix}_frequency_select`]?.selected_option?.value
    ?? '';
  const freq = selectedFreq === 'none' ? '' : selectedFreq;
  if (!freq) return { freq: '', days: [], time: '' };

  const time = values?.[`${prefix}_time`]?.value?.selected_time || '';
  if (freq === 'weekly') {
    return {
      freq,
      days: (values?.[`${prefix}_days_of_week`]?.value?.selected_options || []).map(o => o.value),
      time,
    };
  }
  if (freq === 'monthly') {
    return {
      freq,
      days: (values?.[`${prefix}_day_of_month`]?.value?.selected_options || []).map(o => o.value),
      time,
    };
  }
  return { freq, days: [], time };
}

// Like buildScheduleFieldBlocks but with a separate action_id namespace so edit
// modal dispatch actions don't conflict with the create modal handlers.
function buildEditScheduleFieldBlocks(prefix, labelText, freq, initialTime = '', initialDays = []) {
  const freqOptions = [
    { text: { type: 'plain_text', text: 'No recurring schedule' }, value: 'none' },
    { text: { type: 'plain_text', text: 'Daily' }, value: 'daily' },
    { text: { type: 'plain_text', text: 'Weekly' }, value: 'weekly' },
    { text: { type: 'plain_text', text: 'Monthly' }, value: 'monthly' },
  ];
  const initialFreqOption = freqOptions.find(o => o.value === (freq || 'none'));
  const blocks = [{
    type: 'input',
    block_id: `edit_${prefix}_frequency`,
    label: { type: 'plain_text', text: labelText },
    optional: true,
    dispatch_action: true,
    element: {
      type: 'static_select',
      action_id: `edit_${prefix}_frequency_select`,
      placeholder: { type: 'plain_text', text: 'No recurring schedule' },
      options: freqOptions,
      ...(initialFreqOption ? { initial_option: initialFreqOption } : {}),
    },
  }];

  if (freq === 'weekly') {
    const weekdayOptions = [
      { text: { type: 'plain_text', text: 'Monday' }, value: 'monday' },
      { text: { type: 'plain_text', text: 'Tuesday' }, value: 'tuesday' },
      { text: { type: 'plain_text', text: 'Wednesday' }, value: 'wednesday' },
      { text: { type: 'plain_text', text: 'Thursday' }, value: 'thursday' },
      { text: { type: 'plain_text', text: 'Friday' }, value: 'friday' },
      { text: { type: 'plain_text', text: 'Saturday' }, value: 'saturday' },
      { text: { type: 'plain_text', text: 'Sunday' }, value: 'sunday' },
    ];
    const preSelected = initialDays.length
      ? weekdayOptions.filter(o => initialDays.includes(o.value))
      : [weekdayOptions[0]];
    blocks.push({
      type: 'input',
      block_id: `edit_${prefix}_days_of_week`,
      label: { type: 'plain_text', text: 'Days of Week' },
      optional: true,
      element: {
        type: 'checkboxes',
        action_id: 'value',
        options: weekdayOptions,
        initial_options: preSelected,
      },
    });
  }

  if (freq === 'monthly') {
    const dayOptions = [];
    for (let d = 1; d <= 28; d++) {
      dayOptions.push({ text: { type: 'plain_text', text: monthDayOrdinal(d) }, value: String(d) });
    }
    const preSelected = initialDays.length
      ? dayOptions.filter(o => initialDays.includes(o.value))
      : [dayOptions[0]];
    blocks.push({
      type: 'input',
      block_id: `edit_${prefix}_day_of_month`,
      label: { type: 'plain_text', text: 'Days of Month' },
      optional: true,
      element: {
        type: 'multi_static_select',
        action_id: 'value',
        placeholder: { type: 'plain_text', text: 'Select days' },
        options: dayOptions,
        initial_options: preSelected,
      },
    });
  }

  if (freq) {
    blocks.push({
      type: 'input',
      block_id: `edit_${prefix}_time`,
      label: { type: 'plain_text', text: 'Time (CT)' },
      optional: true,
      hint: { type: 'plain_text', text: 'Central Time. Note: there may be up to 3 hr delays depending on GitHub Actions traffic.' },
      element: {
        type: 'timepicker',
        action_id: 'value',
        placeholder: { type: 'plain_text', text: 'Select time' },
        ...(initialTime ? { initial_time: initialTime } : { initial_time: '09:00' }),
      },
    });
  }

  return blocks;
}

// Builds the pre-filled edit form modal.
// initialValues: { preamble, optionsText, description, anonymous, excludePreviousWinner } — omit to let Slack preserve
// current text field state (used when rebuilding on dispatch_action).
function buildEditPollModal(slug, pollName, initialValues, postParsed, resultsParsed, votingMode) {
  const vm = votingMode || postParsed.freq ? votingMode : '';
  const pollLabel = pollName || titleizeSlug(slug);
  const vmInitial = vm === 'button'
    ? { text: { type: 'plain_text', text: 'Button-based — voters click buttons, live counts shown' }, value: 'button' }
    : { text: { type: 'plain_text', text: 'Reaction-based — voters react with emojis' }, value: 'reaction' };

  const blocks = [
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Editing *${pollLabel}*` }],
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
        placeholder: { type: 'plain_text', text: 'What question are you asking?' },
        ...('preamble' in initialValues ? { initial_value: initialValues.preamble || '' } : {}),
      },
    },
    {
      type: 'input',
      block_id: 'poll_options',
      label: { type: 'plain_text', text: 'Options (one per line, up to 9)' },
      hint: { type: 'plain_text', text: 'One option per line. Optionally prefix with a raw emoji or :shortcode:.' },
      element: {
        type: 'plain_text_input',
        action_id: 'value',
        multiline: true,
        placeholder: { type: 'plain_text', text: ':soccer: Soccer\n:basketball: Basketball' },
        ...('optionsText' in initialValues ? { initial_value: initialValues.optionsText || '' } : {}),
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
        placeholder: { type: 'plain_text', text: 'Add context or rules — shown below the options.' },
        ...('description' in initialValues ? { initial_value: initialValues.description || '' } : {}),
      },
    },
    {
      type: 'input',
      block_id: 'voting_mode',
      label: { type: 'plain_text', text: 'Voting Method' },
      dispatch_action: true,
      element: {
        type: 'radio_buttons',
        action_id: 'edit_voting_mode_select',
        initial_option: vmInitial,
        options: [
          { text: { type: 'plain_text', text: 'Reaction-based — voters react with emojis' }, value: 'reaction' },
          { text: { type: 'plain_text', text: 'Button-based — voters click buttons, live counts shown' }, value: 'button' },
        ],
      },
    },
    ...(vm === 'button' ? [{
      type: 'input',
      block_id: 'show_voters',
      label: { type: 'plain_text', text: 'Voter Visibility' },
      optional: true,
      element: {
        type: 'checkboxes',
        action_id: 'value',
        options: [{ text: { type: 'plain_text', text: 'Show who voted under each option' }, value: 'show' }],
        ...('anonymous' in initialValues && initialValues.anonymous === false
          ? { initial_options: [{ text: { type: 'plain_text', text: 'Show who voted under each option' }, value: 'show' }] }
          : {}),
      },
    }] : []),
    {
      type: 'input',
      block_id: 'exclude_previous_winner',
      label: { type: 'plain_text', text: 'Previous Winner Exclusion' },
      optional: true,
      element: {
        type: 'checkboxes',
        action_id: 'value',
        options: [{
          text: { type: 'plain_text', text: 'Exclude the previous posted winner the next time this poll is posted' },
          value: 'exclude',
        }],
        ...('excludePreviousWinner' in initialValues && initialValues.excludePreviousWinner
          ? { initial_options: [{ text: { type: 'plain_text', text: 'Exclude the previous posted winner the next time this poll is posted' }, value: 'exclude' }] }
          : {}),
      },
    },
    ...buildEditScheduleFieldBlocks('schedule', 'Post Schedule', postParsed.freq, postParsed.time, postParsed.days),
    ...buildEditScheduleFieldBlocks('results', 'Results Schedule', resultsParsed.freq, resultsParsed.time, resultsParsed.days),
  ];

  return {
    type: 'modal',
    callback_id: 'edit_poll',
    private_metadata: JSON.stringify({ slug, poll_name: pollLabel }),
    title: { type: 'plain_text', text: 'Edit Poll' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks,
  };
}

// Updates an existing poll JSON file on GitHub (GET sha → PUT with sha).
async function updatePollFile(slug, pollData, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/polls/${slug}.json`;
  const getResp = await fetch(url, { headers: ghHeaders(env) });
  if (!getResp.ok) throw new Error(`Poll file not found: ${slug}`);
  const { sha } = await getResp.json();
  const content = JSON.stringify(pollData, null, 2);
  const putResp = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Update poll: ${slug}`, content: toBase64(content), sha, branch: 'main' }),
  });
  if (!putResp.ok) {
    const text = await putResp.text();
    throw new Error(`GitHub API ${putResp.status}: ${text}`);
  }
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
  const options = polls.map(({ slug, label }) => ({
    text: { type: 'plain_text', text: label },
    value: slug,
  }));

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
  const options = polls.map(({ slug, label }) => ({
    text: { type: 'plain_text', text: label },
    value: slug,
  }));

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
  const options = polls.map(({ slug, label }) => ({
    text: { type: 'plain_text', text: label },
    value: slug,
  }));

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
  const options = polls.map(({ slug, label }) => ({
    text: { type: 'plain_text', text: label },
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

async function openEditSelectorModal(triggerId, channelId, userId, polls, env) {
  const options = polls.map(({ slug, label }) => ({
    text: { type: 'plain_text', text: label },
    value: slug,
  }));

  const modal = {
    type: 'modal',
    callback_id: 'select_poll_to_edit',
    private_metadata: JSON.stringify({ channel_id: channelId, user_id: userId }),
    title: { type: 'plain_text', text: 'Edit a Poll' },
    submit: { type: 'plain_text', text: 'Continue' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: "Select a poll to edit. Only polls you created (or all polls if you're admin) can be edited." },
      },
      {
        type: 'input',
        block_id: 'poll_select',
        label: { type: 'plain_text', text: 'Which poll would you like to edit?' },
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
    } else if (action?.action_id === 'voting_mode_select') {
      const selectedVotingMode = action.selected_option?.value || '';
      const v = payload.view?.state?.values || {};
      const postParsed = readCreateScheduleState(v, 'schedule');
      const resultsParsed = readCreateScheduleState(v, 'results');
      const viewId = payload.view?.id;
      let viewMeta = {};
      try { viewMeta = JSON.parse(payload.view?.private_metadata || '{}'); } catch {}
      const work = async () => {
        await fetch('https://slack.com/api/views.update', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            view_id: viewId,
            view: buildCreatePollModal(viewMeta.channel_id || '', viewMeta.user_id || '', postParsed.freq, resultsParsed.freq, selectedVotingMode, postParsed, resultsParsed),
          }),
        });
      };
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    } else if (action?.action_id === 'schedule_frequency_select') {
      const selectedFreq = action.selected_option?.value || '';
      const v = payload.view?.state?.values || {};
      const postParsed = readCreateScheduleState(v, 'schedule', selectedFreq);
      const resultsParsed = readCreateScheduleState(v, 'results');
      const currentVotingMode = v?.voting_mode?.voting_mode_select?.selected_option?.value || '';
      const viewId = payload.view?.id;
      let viewMeta = {};
      try { viewMeta = JSON.parse(payload.view?.private_metadata || '{}'); } catch {}
      const work = async () => {
        await fetch('https://slack.com/api/views.update', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            view_id: viewId,
            view: buildCreatePollModal(viewMeta.channel_id || '', viewMeta.user_id || '', postParsed.freq, resultsParsed.freq, currentVotingMode, postParsed, resultsParsed),
          }),
        });
      };
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    } else if (action?.action_id === 'results_frequency_select') {
      const selectedResultsFreq = action.selected_option?.value || '';
      const v = payload.view?.state?.values || {};
      const postParsed = readCreateScheduleState(v, 'schedule');
      const resultsParsed = readCreateScheduleState(v, 'results', selectedResultsFreq);
      const currentVotingMode = v?.voting_mode?.voting_mode_select?.selected_option?.value || '';
      const viewId = payload.view?.id;
      let viewMeta = {};
      try { viewMeta = JSON.parse(payload.view?.private_metadata || '{}'); } catch {}
      const work = async () => {
        await fetch('https://slack.com/api/views.update', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            view_id: viewId,
            view: buildCreatePollModal(viewMeta.channel_id || '', viewMeta.user_id || '', postParsed.freq, resultsParsed.freq, currentVotingMode, postParsed, resultsParsed),
          }),
        });
      };
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    } else if (action?.action_id === 'edit_voting_mode_select') {
      const selectedVotingMode = action.selected_option?.value || 'reaction';
      const viewId = payload.view?.id;
      let viewMeta = {};
      try { viewMeta = JSON.parse(payload.view?.private_metadata || '{}'); } catch {}
      const v = payload.view?.state?.values || {};
      const postParsed = readEditScheduleState(v, 'schedule');
      const resultsParsed = readEditScheduleState(v, 'results');
      const work = async () => {
        await fetch('https://slack.com/api/views.update', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            view_id: viewId,
            view: buildEditPollModal(viewMeta.slug || '', viewMeta.poll_name || '', {}, postParsed, resultsParsed, selectedVotingMode),
          }),
        });
      };
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    } else if (action?.action_id === 'edit_schedule_frequency_select') {
      const selectedPostFreq = action.selected_option?.value || '';
      const viewId = payload.view?.id;
      let viewMeta = {};
      try { viewMeta = JSON.parse(payload.view?.private_metadata || '{}'); } catch {}
      const v = payload.view?.state?.values || {};
      const currentVotingMode = v.voting_mode?.edit_voting_mode_select?.selected_option?.value || 'reaction';
      const postParsed = readEditScheduleState(v, 'schedule', selectedPostFreq);
      const resultsParsed = readEditScheduleState(v, 'results');
      const work = async () => {
        await fetch('https://slack.com/api/views.update', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            view_id: viewId,
            view: buildEditPollModal(viewMeta.slug || '', viewMeta.poll_name || '', {}, postParsed, resultsParsed, currentVotingMode),
          }),
        });
      };
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    } else if (action?.action_id === 'edit_results_frequency_select') {
      const selectedResultsFreq = action.selected_option?.value || '';
      const viewId = payload.view?.id;
      let viewMeta = {};
      try { viewMeta = JSON.parse(payload.view?.private_metadata || '{}'); } catch {}
      const v = payload.view?.state?.values || {};
      const currentVotingMode = v.voting_mode?.edit_voting_mode_select?.selected_option?.value || 'reaction';
      const postParsed = readEditScheduleState(v, 'schedule');
      const resultsParsed = readEditScheduleState(v, 'results', selectedResultsFreq);
      const work = async () => {
        await fetch('https://slack.com/api/views.update', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            view_id: viewId,
            view: buildEditPollModal(viewMeta.slug || '', viewMeta.poll_name || '', {}, postParsed, resultsParsed, currentVotingMode),
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
          const voters = {};
          for (const [uid, optIdx] of Object.entries(existing)) {
            counts[optIdx] = (counts[optIdx] || 0) + 1;
            if (!voters[optIdx]) voters[optIdx] = [];
            voters[optIdx].push(uid);
          }

          const blocks = buildButtonPollBlocks(pollData, counts, slug, voters);
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
    if (selected) inputs.poll_name = selected;

    const dispatchPromise = triggerWorkflow('post_poll.yml', env, inputs)
      .then(() => {
        if (meta.channel_id && meta.user_id) {
          const label = payload.view.state.values.poll_select?.value?.selected_option?.text?.text || selected;
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
        if (selected) {
          const pollData = await getPollData(selected, env);
          if (pollData?.voting_mode === 'button') {
            await postButtonPollResults(selected, pollData, channelId, userId, env);
            return;
          }
        }
        await triggerWorkflow('post_results.yml', env, { channel_id: channelId, poll_name: selected });
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
    if (selected) inputs.poll_name = selected;

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

  // ── select_poll_to_edit: user chose a poll to edit → push edit form ────────
  if (callbackId === 'select_poll_to_edit') {
    const selected = payload.view.state.values.poll_select?.value?.selected_option?.value || '';
    const userId = payload.user?.id;
    const pollData = await getPollData(selected, env);
    if (!pollData) {
      return modalError('poll_select', `Poll \`${selected}\` not found.`);
    }
    if (pollData.author_id && pollData.author_id !== userId && userId !== env.ADMIN_USER_ID) {
      return modalError('poll_select', 'Only the poll author or admin can edit this poll.');
    }
    const postParsed = parseSchedule(pollData.schedule || '');
    const resultsParsed = parseSchedule(pollData.results_schedule || '');
    const votingMode = pollData.voting_mode || 'reaction';
    const optionsText = (pollData.options || []).map((opt, i) => {
      const emoji = pollData.emojis?.[i] || '';
      return emoji ? `:${emoji}: ${opt}` : opt;
    }).join('\n');
    const initialValues = {
      preamble: pollData.preamble || '',
      optionsText,
      description: pollData.description || '',
      anonymous: pollData.anonymous,
      excludePreviousWinner: Boolean(pollData.exclude_previous_winner),
    };
    return new Response(JSON.stringify({
      response_action: 'push',
      view: buildEditPollModal(selected, pollData.name || titleizeSlug(selected), initialValues, postParsed, resultsParsed, votingMode),
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // ── edit_poll: user saved edits to an existing poll ──────────────────────
  if (callbackId === 'edit_poll') {
    const slug = meta.slug || '';
    const userId = payload.user?.id;
    const values = payload.view.state.values;

    const preambleRaw = values.poll_preamble?.value?.value?.trim() || '';
    const optionsRaw = values.poll_options?.value?.value?.trim() || '';
    const descriptionRaw = values.poll_description?.value?.value?.trim() || '';
    const votingModeRaw = values.voting_mode?.edit_voting_mode_select?.selected_option?.value || 'reaction';
    const showVoters = votingModeRaw === 'button' && (values.show_voters?.value?.selected_options || []).some(o => o.value === 'show');
    const excludePreviousWinner = (values.exclude_previous_winner?.value?.selected_options || []).some(o => o.value === 'exclude');

    const scheduleFreq = values.edit_schedule_frequency?.edit_schedule_frequency_select?.selected_option?.value || '';
    const scheduleDaysOfWeek = (values.edit_schedule_days_of_week?.value?.selected_options || []).map(o => o.value);
    const scheduleDaysOfMonth = (values.edit_schedule_day_of_month?.value?.selected_options || []).map(o => o.value);
    const scheduleTime = values.edit_schedule_time?.value?.selected_time || '';

    let scheduleRaw = '';
    if (scheduleFreq) {
      if (scheduleFreq === 'daily') {
        scheduleRaw = `daily ${scheduleTime}`;
      } else if (scheduleFreq === 'weekly') {
        scheduleRaw = `${scheduleDaysOfWeek.join(' ')} ${scheduleTime}`;
      } else if (scheduleFreq === 'monthly') {
        scheduleRaw = `monthly ${scheduleDaysOfMonth.join(' ')} ${scheduleTime}`;
      }
    }

    const resultsFreq = values.edit_results_frequency?.edit_results_frequency_select?.selected_option?.value || '';
    const resultsDaysOfWeek = (values.edit_results_days_of_week?.value?.selected_options || []).map(o => o.value);
    const resultsDaysOfMonth = (values.edit_results_day_of_month?.value?.selected_options || []).map(o => o.value);
    const resultsTime = values.edit_results_time?.value?.selected_time || '';

    let resultsScheduleRaw = '';
    if (resultsFreq) {
      if (resultsFreq === 'daily') {
        resultsScheduleRaw = `daily ${resultsTime}`;
      } else if (resultsFreq === 'weekly') {
        resultsScheduleRaw = `${resultsDaysOfWeek.join(' ')} ${resultsTime}`;
      } else if (resultsFreq === 'monthly') {
        resultsScheduleRaw = `monthly ${resultsDaysOfMonth.join(' ')} ${resultsTime}`;
      }
    }

    const editOptions = [];
    const editEmojis = [];
    for (const line of optionsRaw.split('\n').map(l => l.trim()).filter(Boolean)) {
      const namedMatch = line.match(/^:([a-z0-9_+\-]+):\s*(.+)$/);
      if (namedMatch) {
        let emojiName = namedMatch[1];
        const char = emojiGet(emojiName);
        if (char) { const canonical = unicodeToSlack(char); if (canonical) emojiName = canonical; }
        editEmojis.push(emojiName);
        editOptions.push(namedMatch[2].trim());
        continue;
      }
      const unicodeMatch = line.match(/^(\p{Extended_Pictographic}️?)\s+(.+)$/u);
      if (unicodeMatch) {
        const name = unicodeToSlack(unicodeMatch[1]);
        editEmojis.push(name || NUMBER_EMOJIS[editOptions.length] || 'question');
        editOptions.push(unicodeMatch[2].trim());
        continue;
      }
      editEmojis.push(NUMBER_EMOJIS[editOptions.length] || 'question');
      editOptions.push(line);
    }

    if (editOptions.length < 2) return modalError('poll_options', 'Please enter at least 2 options.');
    if (editOptions.length > 9) return modalError('poll_options', 'Maximum 9 options allowed.');

    const work = async () => {
      try {
        const pollData = await getPollData(slug, env);
        if (!pollData) { console.error('edit_poll: poll not found:', slug); return; }
        if (pollData.author_id && pollData.author_id !== userId && userId !== env.ADMIN_USER_ID) {
          console.error('edit_poll: unauthorized:', userId, slug); return;
        }

        const updated = { ...pollData };
        if (preambleRaw) updated.preamble = preambleRaw; else delete updated.preamble;
        updated.options = editOptions;
        updated.emojis = editEmojis;
        if (descriptionRaw) updated.description = descriptionRaw; else delete updated.description;
        updated.voting_mode = votingModeRaw;
        if (votingModeRaw === 'button') {
          updated.anonymous = !showVoters;
        } else {
          delete updated.anonymous;
        }
        if (excludePreviousWinner) updated.exclude_previous_winner = true; else delete updated.exclude_previous_winner;
        if (scheduleRaw) updated.schedule = scheduleRaw; else delete updated.schedule;
        if (resultsScheduleRaw) updated.results_schedule = resultsScheduleRaw; else delete updated.results_schedule;

        await updatePollFile(slug, updated, env);

        const channelId = pollData.channel_id || meta.channel_id || '';
        if (channelId && userId) {
          await postEphemeral(channelId, userId, `✅ Poll *${pollData.name}* updated successfully!`, env);
        }
      } catch (e) {
        console.error('edit_poll error:', e);
      }
    };
    if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(work());
    return new Response('', { status: 200 });
  }

  // ── create_poll: user submitted a new poll form ───────────────────────────
  if (callbackId !== 'create_poll') return new Response('', { status: 200 });

  const values = payload.view.state.values;
  const nameRaw = values.poll_name?.value?.value?.trim() || '';
  const preambleRaw = values.poll_preamble?.value?.value?.trim() || '';
  const optionsRaw = values.poll_options?.value?.value?.trim() || '';
  const descriptionRaw = values.poll_description?.value?.value?.trim() || '';
  const votingModeRaw = values.voting_mode?.voting_mode_select?.selected_option?.value || 'reaction';
  const showVoters = votingModeRaw === 'button' && (values.show_voters?.value?.selected_options || []).some(o => o.value === 'show');
  const excludePreviousWinner = (values.exclude_previous_winner?.value?.selected_options || []).some(o => o.value === 'exclude');
  const scheduleFreq = values.schedule_frequency?.schedule_frequency_select?.selected_option?.value || '';
  const scheduleDaysOfWeek = (values.schedule_days_of_week?.value?.selected_options || []).map(o => o.value);
  const scheduleDaysOfMonth = (values.schedule_day_of_month?.value?.selected_options || []).map(o => o.value);
  const scheduleTime = values.schedule_time?.value?.selected_time || '';

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
  const resultsTime = values.results_time?.value?.selected_time || '';

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
    // :emoji_name: Label — normalize through node-emoji so names like :robot: → robot_face
    const namedMatch = line.match(/^:([a-z0-9_+\-]+):\s*(.+)$/);
    if (namedMatch) {
      let emojiName = namedMatch[1];
      const char = emojiGet(emojiName);
      if (char) {
        const canonical = unicodeToSlack(char);
        if (canonical) emojiName = canonical;
      }
      emojis.push(emojiName);
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

  const commitPromise = commitPollFile(slug, nameRaw, options, emojis, preambleRaw, descriptionRaw, payload.user?.id, votingModeRaw, scheduleRaw, resultsScheduleRaw, meta.channel_id || '', showVoters ? false : true, excludePreviousWinner, env)
    .then(async () => {
      const promises = [];
      if (meta.channel_id && meta.user_id) {
        promises.push(postEphemeral(
          meta.channel_id,
          meta.user_id,
          `✅ Poll *${nameRaw}* saved! It will appear in \`/newpoll\` next time.`,
          env,
        ));
      }
      if (env.ADMIN_USER_ID && payload.user?.id !== env.ADMIN_USER_ID) {
        const modeLabel = votingModeRaw === 'button' ? 'Button' : 'Reaction';
        const optionLines = options.map((o, i) => `:${emojis[i]}: ${o}`).join('\n');
        const scheduleNote = scheduleRaw ? `\n📅 Post: ${formatSchedule(scheduleRaw)}` : '';
        const resultsNote = resultsScheduleRaw ? `\n📊 Results: ${formatSchedule(resultsScheduleRaw)}` : '';
        promises.push(fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: env.ADMIN_USER_ID,
            text: `🆕 New poll created by <@${payload.user?.id}>: *${nameRaw}*`,
            blocks: [{
              type: 'section',
              text: { type: 'mrkdwn', text: `🆕 *New poll created* by <@${payload.user?.id}>\n\n*${nameRaw}*\n${optionLines}\n\n🗳️ Mode: ${modeLabel}${scheduleNote}${resultsNote}` },
            }],
          }),
        }));
      }
      await Promise.all(promises);
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
      try {
        const weeklyPoll = await getPollData('weekly', env);
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
          formatPollOptionsText(weeklyPoll),
          '',
          'For custom polls, the options are shown right in the poll message. If the poll uses default numbering, react with 1️⃣ 2️⃣ 3️⃣ and so on.',
          '',
          '*Step 4:* That\'s it. You\'re done. There is no step 5. Please rejoin society.',
          '',
          '_One reaction per option. Voting for everything is not a strategy, it\'s a cry for help. Use `/results` to watch your pick lose in real time._',
        ].join('\n'));
      } catch (e) {
        console.error('vote help error:', e);
        return ephemeral([
          '🗳️ *How to Vote (Yes, We Know You Need This Explained)*',
          '',
          '*Step 1:* Find the poll in the channel.',
          '*Step 2:* Add the emoji reaction that matches your choice.',
          '*Step 3:* Use `/results` to check the tally.',
        ].join('\n'));
      }

    case '/results': {
      const resultsWork = async () => {
        try {
          const polls = await listPollChoices(env) || [];
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
          const polls = await listPollChoices(env) || [];
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
          const polls = await listPollChoices(env) || [];
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
          const polls = await listPollChoices(env) || [];
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

    case '/edit': {
      const editWork = async () => {
        try {
          const polls = await listPollChoices(env) || [];
          if (polls.length === 0) {
            await postEphemeral(channelId, userId, 'No custom polls to edit. Use `/create` to make one.', env);
            return;
          }
          await openEditSelectorModal(triggerId, channelId, userId, polls, env);
        } catch (e) {
          console.error('edit modal error:', e);
          await postEphemeral(channelId, userId, '❌ Failed to open edit selector. Please try again.', env);
        }
      };
      const ew = editWork();
      if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(ew);
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
        const polls = await listPollChoices(env);
        if (polls === null) return ephemeral('Failed to fetch polls. Please try again.');
        const lines = polls.map(p => `• \`${p.slug}\` — ${p.label}`);
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
export { formatSchedule, buildButtonPollBlocks, slugify, parseSchedule, optionLine, monthDayOrdinal, verifySlackSignature, handleInteraction, handleSlashCommand };
