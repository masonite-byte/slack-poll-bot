// Poll options — kept in sync with internal/poll/poll.go
const POLL_OPTIONS_TEXT = [
  ':soccer: Soccer',
  ':basketball: Basketball',
  ':flying_disc: Ultimate Frisbee',
  ':volleyball: Volleyball',
  ':athletic_shoe: Hackeysack',
  ':question: Other?????',
].join('\n');

const HELP_TEXT = [
  'Supported slash commands:',
  '/pollstatus - show the current poll results and counts.',
  '/newpoll - post a new poll message.',
  '/runoff - start a runoff poll when the latest poll is tied.',
  '/options - list poll options and emoji.',
  '/vote - instructions for voting via emoji reactions.',
  '/help - show this help text.',
].join('\n');

async function verifySlackSignature(request, body, signingSecret) {
  const timestamp = request.headers.get('X-Slack-Request-Timestamp');
  const slackSig = request.headers.get('X-Slack-Signature');
  if (!timestamp || !slackSig) return false;

  // Reject requests older than 5 minutes to prevent replay attacks
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

async function triggerWorkflow(workflowFile, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${workflowFile}/dispatches`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub API ${resp.status}: ${text}`);
  }
}

function ephemeral(text, status = 200) {
  return new Response(JSON.stringify({ response_type: 'ephemeral', text }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleSlashCommand(request, env) {
  const body = await request.text();

  if (!await verifySlackSignature(request, body, env.SLACK_SIGNING_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const params = new URLSearchParams(body);
  const command = params.get('command');

  switch (command) {
    case '/help':
      return ephemeral(HELP_TEXT);

    case '/options':
      return ephemeral('Available poll options:\n' + POLL_OPTIONS_TEXT);

    case '/vote':
      return ephemeral(
        'Vote by reacting to the current poll message with one of the following emojis:\n' +
        POLL_OPTIONS_TEXT +
        '\nUse /results to check the current tally.',
      );

    case '/pollstatus':
      try {
        await triggerWorkflow('post_results.yml', env);
        return ephemeral('Results are being computed and will be posted to the channel shortly.');
      } catch (e) {
        console.error('results workflow error:', e);
        return ephemeral('Failed to fetch results. Please try again.');
      }

    case '/newpoll':
      try {
        await triggerWorkflow('post_poll.yml', env);
        return ephemeral('New poll will be posted to the channel shortly.');
      } catch (e) {
        console.error('newpoll workflow error:', e);
        return ephemeral('Failed to post new poll. Please try again.');
      }

    case '/runoff':
      try {
        await triggerWorkflow('check_ties.yml', env);
        return ephemeral('Checking for ties and posting runoff poll if needed. Check the channel shortly.');
      } catch (e) {
        console.error('runoff workflow error:', e);
        return ephemeral('Failed to trigger runoff. Please try again.');
      }

    default:
      return ephemeral('Unsupported slash command. Use /help to see available commands.');
  }
}

// Returns the current hour (0-23) in Chicago time
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
        await triggerWorkflow('post_poll.yml', env);
      } else {
        console.log(`Skipping poll post — Chicago hour is ${hour}, expected 9`);
      }
      break;

    case '5 22 * * 2':
    case '5 23 * * 2':
      if (hour === 17) {
        console.log('Triggering tie check');
        await triggerWorkflow('check_ties.yml', env);
      } else {
        console.log(`Skipping tie check — Chicago hour is ${hour}, expected 17`);
      }
      break;

    case '5 22 * * 3':
    case '5 23 * * 3':
      if (hour === 17) {
        console.log('Triggering results post');
        await triggerWorkflow('post_results.yml', env);
      } else {
        console.log(`Skipping results post — Chicago hour is ${hour}, expected 17`);
      }
      break;

    default:
      console.warn('Unknown cron expression:', cron);
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/slack/commands' && request.method === 'POST') {
      return handleSlashCommand(request, env);
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env) {
    await handleScheduled(event.cron, env);
  },
};
