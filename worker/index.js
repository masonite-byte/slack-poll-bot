const HELP_TEXT = [
  'Supported slash commands:',
  '/results   - show the current poll results.',
  '/newpoll   - pick and post a poll from a dropdown.',
  '/runoff    - start a runoff poll when tied.',
  '/notify    - DM voters with their results.',
  '/delete    - permanently delete a custom poll (authors only).',
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

// Maps raw Unicode emoji characters to their Slack reaction names.
const UNICODE_TO_SLACK = {
  // Faces
  '😀':'grinning','😃':'smiley','😄':'smile','😁':'grin','😆':'laughing',
  '😅':'sweat_smile','🤣':'rofl','😂':'joy','🙂':'slightly_smiling_face',
  '😊':'blush','😇':'innocent','😍':'heart_eyes','😎':'sunglasses',
  '🤩':'star_struck','🥳':'partying_face','😋':'yum','😛':'stuck_out_tongue',
  '😜':'stuck_out_tongue_winking_eye','😐':'neutral_face','😑':'expressionless',
  '😏':'smirk','😒':'unamused','🙄':'roll_eyes','😬':'grimacing',
  '😌':'relieved','😔':'pensive','😴':'sleeping','😷':'mask',
  '🤢':'nauseated_face','🤧':'sneezing_face','🤯':'exploding_head',
  '🤠':'cowboy_hat_face','🤓':'nerd_face','😈':'smiling_imp','👿':'imp',
  '💩':'hankey','🤖':'robot_face','💀':'skull',
  // Hands & gestures
  '👋':'wave','✋':'raised_hand','👍':'+1','👎':'-1',
  '✊':'fist','👊':'facepunch','👏':'clap','🙌':'raised_hands',
  '🙏':'pray','💪':'muscle','✌️':'v','🤞':'crossed_fingers',
  '🤙':'call_me_hand','👈':'point_left','👉':'point_right',
  '👆':'point_up_2','👇':'point_down',
  // Hearts & symbols
  '❤️':'heart','🧡':'orange_heart','💛':'yellow_heart','💚':'green_heart',
  '💙':'blue_heart','💜':'purple_heart','🖤':'black_heart','💔':'broken_heart',
  '💯':'100','✅':'white_check_mark','❌':'x','⭕':'o','🚫':'no_entry_sign',
  '❓':'question','❗':'exclamation','⚡':'zap','🔥':'fire','💥':'boom',
  '⭐':'star','🌟':'star2','🎉':'tada','🏆':'trophy',
  '🥇':'first_place_medal','🥈':'second_place_medal','🥉':'third_place_medal',
  // Sports & activities
  '⚽':'soccer','🏀':'basketball','🏈':'football','⚾':'baseball',
  '🎾':'tennis','🏐':'volleyball','🏉':'rugby_football','🥏':'flying_disc',
  '🏓':'ping_pong','🏸':'badminton','🥊':'boxing_glove','🥋':'martial_arts_uniform',
  '🏊':'swimmer','🏄':'surfer','🚴':'bicyclist','🧗':'climbing',
  '🤸':'cartwheel','🏋️':'weight_lifter','🎯':'dart','🎱':'8ball',
  '🎿':'ski','🏹':'bow_and_arrow','🎣':'fishing_pole_and_fish',
  '🧘':'person_in_lotus_position','🏇':'horse_racing',
  // Food & drink
  '🍕':'pizza','🍔':'hamburger','🌮':'taco','🍺':'beer','🥂':'clinking_glasses',
  // Nature & weather
  '☀️':'sunny','🌙':'crescent_moon','🌈':'rainbow','⛄':'snowman',
  // Misc
  '🚀':'rocket','💡':'bulb','🎮':'video_game','📊':'bar_chart',
  '📈':'chart_with_upwards_trend','🎨':'art','🎵':'musical_note',
};

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

async function commitPollFile(slug, name, options, emojis, preamble, description, authorId, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/polls/${slug}.json`;
  const pollData = { name, options, emojis, author_id: authorId };
  if (preamble) pollData.preamble = preamble;
  if (description) pollData.description = description;
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
        block_id: 'poll_preamble',
        label: { type: 'plain_text', text: 'Intro (optional)' },
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
        hint: { type: 'plain_text', text: 'One option per line. Prefix with an emoji to set the reaction: use :emoji_name: or paste a raw emoji (e.g. "⚽ Soccer" or ":soccer: Soccer"). Without an emoji, options are numbered 1️⃣ 2️⃣ 3️⃣ automatically.' },
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
        label: { type: 'plain_text', text: 'Description (optional)' },
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'value',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Add context or rules for voters — shown below the options in the poll.' },
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
        if (pollData.author_id && pollData.author_id !== userId) {
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

  // ── create_poll: user submitted a new poll form ───────────────────────────
  if (callbackId !== 'create_poll') return new Response('', { status: 200 });

  const values = payload.view.state.values;
  const nameRaw = values.poll_name?.value?.value?.trim() || '';
  const preambleRaw = values.poll_preamble?.value?.value?.trim() || '';
  const optionsRaw = values.poll_options?.value?.value?.trim() || '';
  const descriptionRaw = values.poll_description?.value?.value?.trim() || '';

  if (!nameRaw) return modalError('poll_name', 'Poll name is required.');

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
      const name = UNICODE_TO_SLACK[unicodeMatch[1]] || UNICODE_TO_SLACK[unicodeMatch[1].replace(/️$/, '')];
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

  const commitPromise = commitPollFile(slug, nameRaw, options, emojis, preambleRaw, descriptionRaw, payload.user?.id, env)
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

    case '/runoff':
      try {
        await triggerWorkflow('runoff.yml', env, { channel_id: channelId });
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
