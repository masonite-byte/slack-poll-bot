const HELP_TEXT = [
  'Supported slash commands:',
  '/results   - show the current poll results.',
  '/newpoll   - pick and post a poll from a dropdown.',
  '/runoff    - start a runoff poll when tied.',
  '/notify    - DM voters with their results.',
  '/delete    - delete the most recent poll.',
  '/create    - create a custom poll via a form.',
  '/polls     - list all available custom polls.',
  '/schedule  - show the weekly poll schedule.',
  '/options   - list weekly poll options and emoji.',
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
  'Built by Mason to solve the most pressing problem in the modern workplace: what sport should we play this week?',
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

const SCHEDULE_TEXT = [
  '📅 *Weekly Poll Schedule*',
  '',
  '• *Monday 9:00 AM CT* — Weekly poll posted',
  '• *Tuesday 5:00 PM CT* — Results posted, voters notified, runoff if tied',
  '',
  'All times are Central Time. Polls run automatically — no human required.',
].join('\n');

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

// Normalises a poll display name to a filename-safe slug, e.g. "Summer Sports" → "summer-sports".
function slugify(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
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

async function commitPollFile(slug, name, options, emojis, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/polls/${slug}.json`;
  const content = JSON.stringify({ name, options, emojis }, null, 2);
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

// ── Slack API helpers ─────────────────────────────────────────────────────────

async function openModal(triggerId, channelId, userId, env) {
  const modal = {
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
        block_id: 'poll_options',
        label: { type: 'plain_text', text: 'Options (one per line, up to 9)' },
        hint: { type: 'plain_text', text: 'One option per line. Start with :emoji_name: to set the reaction voters use (e.g. ":soccer: Soccer"). Without an emoji, options are numbered 1️⃣ 2️⃣ 3️⃣ automatically.' },
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          placeholder: { type: 'plain_text', text: ':soccer: Soccer\n:basketball: Basketball\nSwimming\nPickleball' },
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
    const dispatchPromise = triggerWorkflow('post_results.yml', env, { channel_id: meta.channel_id || '' })
      .then(() => {
        if (meta.channel_id && meta.user_id) {
          return postEphemeral(meta.channel_id, meta.user_id, '📊 Results are being computed and will be posted shortly. The poll will be removed once done.', env);
        }
      })
      .catch(err => {
        console.error('post_results dispatch error:', err);
        if (meta.channel_id && meta.user_id) {
          return postEphemeral(meta.channel_id, meta.user_id, '❌ Failed to post results. Please try again.', env);
        }
      });

    if (typeof env._ctx?.waitUntil === 'function') env._ctx.waitUntil(dispatchPromise);
    return new Response('', { status: 200 });
  }

  // ── create_poll: user submitted a new poll form ───────────────────────────
  if (callbackId !== 'create_poll') return new Response('', { status: 200 });

  const values = payload.view.state.values;
  const nameRaw = values.poll_name?.value?.value?.trim() || '';
  const optionsRaw = values.poll_options?.value?.value?.trim() || '';

  if (!nameRaw) return modalError('poll_name', 'Poll name is required.');

  const options = [];
  const emojis = [];
  for (const line of optionsRaw.split('\n').map(l => l.trim()).filter(Boolean)) {
    const emojiMatch = line.match(/^:([a-z0-9_+\-]+):\s*(.+)$/);
    if (emojiMatch) {
      emojis.push(emojiMatch[1]);
      options.push(emojiMatch[2].trim());
    } else {
      emojis.push(NUMBER_EMOJIS[options.length] || 'question');
      options.push(line);
    }
  }

  if (options.length < 2) return modalError('poll_options', 'Please enter at least 2 options.');
  if (options.length > 9) return modalError('poll_options', 'Maximum 9 options allowed.');

  const slug = slugify(nameRaw);
  if (!slug) return modalError('poll_name', 'Poll name must contain at least one letter or number.');

  if (await pollFileExists(slug, env)) {
    return modalError('poll_name', `A poll named "${nameRaw}" already exists. Choose a different name.`);
  }

  const commitPromise = commitPollFile(slug, nameRaw, options, emojis, env)
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

    case '/options':
      return ephemeral('Available weekly poll options:\n' + POLL_OPTIONS_TEXT);

    case '/vote':
      return ephemeral(
        'Vote by reacting to the current poll message with one of the following emojis:\n' +
        POLL_OPTIONS_TEXT +
        '\nFor custom polls, use the numbered reactions shown in the poll.\n' +
        'Use /results to check the current tally.',
      );

    case '/results': {
      try {
        const polls = await listPolls(env) || [];
        await openResultsModal(triggerId, channelId, userId, polls, env);
        return new Response('', { status: 200 });
      } catch (e) {
        console.error('results modal error:', e);
        return ephemeral('Failed to open results selector. Please try again.');
      }
    }

    case '/newpoll': {
      try {
        const polls = await listPolls(env) || [];
        await openPostPollModal(triggerId, channelId, userId, polls, env);
        return new Response('', { status: 200 });
      } catch (e) {
        console.error('newpoll modal error:', e);
        return ephemeral('Failed to open poll selector. Please try again.');
      }
    }

    case '/runoff':
      try {
        await triggerWorkflow('check_ties.yml', env, { channel_id: channelId });
        return ephemeral('Checking for ties and posting runoff poll if needed. Check the channel shortly.');
      } catch (e) {
        console.error('runoff workflow error:', e);
        return ephemeral('Failed to trigger runoff. Please try again.');
      }

    case '/notify':
      try {
        await triggerWorkflow('notify_voters.yml', env, { channel_id: channelId });
        return ephemeral('Notifying voters with their results. Check your DMs!');
      } catch (e) {
        console.error('notify workflow error:', e);
        return ephemeral('Failed to notify voters. Please try again.');
      }

    case '/delete':
      try {
        await triggerWorkflow('delete_poll.yml', env, { channel_id: channelId });
        return ephemeral('Deleting the most recent poll. Check the channel shortly.');
      } catch (e) {
        console.error('delete workflow error:', e);
        return ephemeral('Failed to delete poll. Please try again.');
      }

    case '/create':
      try {
        await openModal(triggerId, channelId, userId, env);
        return new Response('', { status: 200 });
      } catch (e) {
        console.error('modal open error:', e);
        return ephemeral('Failed to open poll creation form. Please try again.');
      }

    case '/polls': {
      try {
        const polls = await listPolls(env);
        if (polls === null) return ephemeral('Failed to fetch polls. Please try again.');
        if (polls.length === 0) {
          return ephemeral('No custom polls yet. Use `/new` to create one.');
        }
        const list = polls.map(p => `• \`${p}\``).join('\n');
        return ephemeral(`📋 *Available Custom Polls*\n\n${list}\n\nUse \`/newpoll <name>\` to post one.`);
      } catch (e) {
        console.error('polls list error:', e);
        return ephemeral('Failed to fetch polls. Please try again.');
      }
    }

    case '/schedule':
      return ephemeral(SCHEDULE_TEXT);

    case '/about':
      return ephemeral(ABOUT_TEXT);

    case '/ping':
      return ephemeral('pong 🏓');

    default:
      return ephemeral('Unsupported slash command. Use /help to see available commands.');
  }
}

// ── Scheduled handler (kept for future cron use) ──────────────────────────────

function chicagoHour() {
  return parseInt(
    new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }),
    10,
  );
}

async function handleScheduled(cron, env) {
  const hour = chicagoHour();

  switch (cron) {
    case '5 14 * * 1':
    case '5 15 * * 1':
      if (hour === 9) {
        console.log('Triggering weekly poll post');
        await triggerWorkflow('post_poll.yml', env, {});
      } else {
        console.log(`Skipping poll post — Chicago hour is ${hour}, expected 9`);
      }
      break;

    case '0 22 * * 2':
    case '0 23 * * 2':
      if (hour === 17) {
        console.log('Triggering results post');
        await triggerWorkflow('post_results.yml', env, {});
      } else {
        console.log(`Skipping results post — Chicago hour is ${hour}, expected 17`);
      }
      break;

    default:
      console.warn('Unknown cron expression:', cron);
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

  async scheduled(event, env) {
    await handleScheduled(event.cron, env);
  },
};
