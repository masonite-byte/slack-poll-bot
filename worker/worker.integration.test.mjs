/**
 * Integration tests for the Cloudflare Worker request handlers.
 *
 * Uses Node's built-in crypto to generate real Slack HMAC signatures so the
 * full verifySlackSignature path is exercised. Outbound fetch calls (Slack API,
 * GitHub API) are intercepted via a globalThis.fetch mock before each test.
 */

import { createHmac } from 'node:crypto';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

// Mirrors toBase64() in index.js — encodes a string to base64 via UTF-8 bytes.
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

// Wraps a poll object as a GitHub Contents API response body string.
function ghPollBody(pollObj) {
  return JSON.stringify({ content: toBase64(JSON.stringify(pollObj)) });
}

function decodeGitHubContent(body) {
  const parsed = JSON.parse(body);
  return JSON.parse(atob(parsed.content));
}

const SIGNING_SECRET = 'test-secret-32-chars-long-enough!';

function slackSign(body, timestamp = Math.floor(Date.now() / 1000).toString()) {
  const sig = 'v0=' + createHmac('sha256', SIGNING_SECRET)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex');
  return { sig, timestamp };
}

function makeSlashRequest(command, extra = {}) {
  const params = new URLSearchParams({ command, channel_id: 'C_CHAN', user_id: 'U_USER', trigger_id: 'T_TRIG', text: '', ...extra });
  const body = params.toString();
  const { sig, timestamp } = slackSign(body);
  return new Request('https://worker.example/slack/commands', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': sig,
    },
    body,
  });
}

function makeInteractionRequest(payload) {
  const body = 'payload=' + encodeURIComponent(JSON.stringify(payload));
  const { sig, timestamp } = slackSign(body);
  return new Request('https://worker.example/slack/interactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': sig,
    },
    body,
  });
}

function makeKV() {
  const store = new Map();
  return {
    get: async (key, type) => {
      const val = store.get(key);
      if (val === undefined) return null;
      return type === 'json' ? JSON.parse(val) : val;
    },
    put: async (key, val) => { store.set(key, val); },
    _store: store,
  };
}

function makeEnv(overrides = {}) {
  const pending = [];
  const _ctx = {
    waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); },
    flush: () => Promise.all(pending),
  };
  return {
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_SIGNING_SECRET: SIGNING_SECRET,
    GITHUB_TOKEN: 'ghp-test',
    GITHUB_REPO: 'test-owner/test-repo',
    ADMIN_USER_ID: 'U_ADMIN',
    POLL_VOTES: makeKV(),
    _ctx,
    ...overrides,
  };
}

// Capture outbound fetch calls made by the worker and return a canned response.
// Pass { 'url-substring': [bodyString, status] } — a fresh Response is created per call
// so the body stream can be consumed multiple times.
function mockFetch(responses = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    const urlStr = url.toString();
    for (const [pattern, [body, status = 200]] of Object.entries(responses)) {
      if (urlStr.includes(pattern)) return new Response(body, { status });
    }
    return new Response('{}', { status: 200 });
  };
  return calls;
}

// ── Signature verification ────────────────────────────────────────────────────

describe('signature verification', () => {
  test('rejects request with no signature headers', async () => {
    const req = new Request('https://worker.example/slack/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'command=/help',
    });
    const res = await worker.fetch(req, makeEnv(), {});
    assert.equal(res.status, 401);
  });

  test('rejects request with wrong signature', async () => {
    const body = 'command=%2Fhelp&channel_id=C1&user_id=U1&trigger_id=T1&text=';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const req = new Request('https://worker.example/slack/commands', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-Request-Timestamp': timestamp,
        'X-Slack-Signature': 'v0=deadbeefdeadbeefdeadbeefdeadbeef',
      },
      body,
    });
    const res = await worker.fetch(req, makeEnv(), {});
    assert.equal(res.status, 401);
  });

  test('rejects stale timestamp (> 5 min old)', async () => {
    const body = 'command=%2Fhelp&channel_id=C1&user_id=U1&trigger_id=T1&text=';
    const staleTs = (Math.floor(Date.now() / 1000) - 400).toString();
    const { sig } = slackSign(body, staleTs);
    const req = new Request('https://worker.example/slack/commands', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-Request-Timestamp': staleTs,
        'X-Slack-Signature': sig,
      },
      body,
    });
    const res = await worker.fetch(req, makeEnv(), {});
    assert.equal(res.status, 401);
  });

  test('accepts request with valid signature', async () => {
    mockFetch();
    const req = makeSlashRequest('/ping');
    const res = await worker.fetch(req, makeEnv(), {});
    assert.notEqual(res.status, 401);
  });
});

// ── Slash commands ────────────────────────────────────────────────────────────

describe('slash commands', () => {
  beforeEach(() => mockFetch());

  test('/ping returns 200 with pong', async () => {
    const res = await worker.fetch(makeSlashRequest('/ping'), makeEnv(), {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.text, /pong/);
  });

  test('/help returns 200 with ephemeral response', async () => {
    const res = await worker.fetch(makeSlashRequest('/help'), makeEnv(), {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.response_type, 'ephemeral');
    assert.ok(body.text.length > 0);
  });

  test('/about returns 200 with ephemeral response', async () => {
    const res = await worker.fetch(makeSlashRequest('/about'), makeEnv(), {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.response_type, 'ephemeral');
  });

  test('unknown command returns 200 with ephemeral fallback', async () => {
    const res = await worker.fetch(makeSlashRequest('/notacommand'), makeEnv(), {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.response_type, 'ephemeral');
    assert.match(body.text, /Unsupported/i);
  });

  test('/polls with no polls returns ephemeral listing', async () => {
    const fetchCalls = mockFetch({
      'github.com': [JSON.stringify([])],
    });
    const res = await worker.fetch(makeSlashRequest('/polls'), makeEnv(), {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.response_type, 'ephemeral');
    assert.match(body.text, /Available Polls/i);
  });

  test('/polls includes stored weekly poll label', async () => {
    mockFetch({
      '/contents/polls/weekly.json': [ghPollBody({ name: 'Weekly Sports Poll', options: ['Soccer', 'Basketball'] })],
      '/contents/polls/summer-sports.json': [ghPollBody({ name: 'Summer Sports', options: ['Frisbee', 'Volleyball'] })],
      '/contents/polls': [JSON.stringify([
        { type: 'file', name: 'weekly.json' },
        { type: 'file', name: 'summer-sports.json' },
      ])],
    });

    const res = await worker.fetch(makeSlashRequest('/polls'), makeEnv(), {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.text, /`weekly` — Weekly Sports Poll/);
    assert.match(body.text, /`summer-sports` — Summer Sports/);
  });
});

// ── Interaction routing ───────────────────────────────────────────────────────

describe('interaction routing', () => {
  test('non-POST to /slack/interactions returns 404', async () => {
    const res = await worker.fetch(
      new Request('https://worker.example/slack/interactions', { method: 'GET' }),
      makeEnv(), {},
    );
    assert.equal(res.status, 404);
  });

  test('unknown path returns 404', async () => {
    const res = await worker.fetch(
      new Request('https://worker.example/unknown', { method: 'POST' }),
      makeEnv(), {},
    );
    assert.equal(res.status, 404);
  });
});

// ── poll_vote block action ────────────────────────────────────────────────────

describe('poll_vote', () => {
  test('records a vote in KV and calls chat.update', async () => {
    const kv = makeKV();
    const poll = { name: 'Test Poll', options: ['A', 'B'], emojis: ['one', 'two'], voting_mode: 'button' };
    const fetchCalls = mockFetch({
      'api.github.com': [ghPollBody(poll)],
      'slack.com/api/chat.update': [JSON.stringify({ ok: true })],
    });

    const env = makeEnv({ POLL_VOTES: kv });
    const payload = {
      type: 'block_actions',
      user: { id: 'U_VOTER' },
      channel: { id: 'C_CHAN' },
      message: { ts: '123.456' },
      actions: [{ action_id: 'poll_vote', value: 'test-poll:0' }],
    };

    const res = await worker.fetch(makeInteractionRequest(payload), env, env._ctx);
    assert.equal(res.status, 200);
    await env._ctx.flush();

    const stored = await kv.get('votes:test-poll:C_CHAN:123.456', 'json');
    assert.deepEqual(stored, { U_VOTER: 0 });

    const updateCall = fetchCalls.find(c => c.url.includes('chat.update'));
    assert.ok(updateCall, 'should have called chat.update');
  });

  test('toggling the same option removes the vote', async () => {
    const kv = makeKV();
    await kv.put('votes:test-poll:C_CHAN:123.456', JSON.stringify({ U_VOTER: 0 }));

    const poll = { name: 'Test Poll', options: ['A', 'B'], emojis: ['one', 'two'], voting_mode: 'button' };
    mockFetch({
      'api.github.com': [ghPollBody(poll)],
      'slack.com': [JSON.stringify({ ok: true })],
    });

    const env = makeEnv({ POLL_VOTES: kv });
    const payload = {
      type: 'block_actions',
      user: { id: 'U_VOTER' },
      channel: { id: 'C_CHAN' },
      message: { ts: '123.456' },
      actions: [{ action_id: 'poll_vote', value: 'test-poll:0' }],
    };

    await worker.fetch(makeInteractionRequest(payload), env, env._ctx);
    await env._ctx.flush();

    const stored = await kv.get('votes:test-poll:C_CHAN:123.456', 'json');
    assert.deepEqual(stored, {}, 'vote should be removed on re-click');
  });

  test('changing vote updates the stored option index', async () => {
    const kv = makeKV();
    await kv.put('votes:test-poll:C_CHAN:123.456', JSON.stringify({ U_VOTER: 0 }));

    const poll = { name: 'Test Poll', options: ['A', 'B'], emojis: ['one', 'two'], voting_mode: 'button' };
    mockFetch({
      'api.github.com': [ghPollBody(poll)],
      'slack.com': [JSON.stringify({ ok: true })],
    });

    const env = makeEnv({ POLL_VOTES: kv });
    const payload = {
      type: 'block_actions',
      user: { id: 'U_VOTER' },
      channel: { id: 'C_CHAN' },
      message: { ts: '123.456' },
      actions: [{ action_id: 'poll_vote', value: 'test-poll:1' }],
    };

    await worker.fetch(makeInteractionRequest(payload), env, env._ctx);
    await env._ctx.flush();

    const stored = await kv.get('votes:test-poll:C_CHAN:123.456', 'json');
    assert.deepEqual(stored, { U_VOTER: 1 }, 'vote should update to option 1');
  });
});

describe('selected poll workflows', () => {
  test('post_results forwards the selected weekly slug to the workflow', async () => {
    const fetchCalls = mockFetch({
      '/actions/workflows/post_results.yml/dispatches': ['{}', 200],
      'slack.com/api/chat.postEphemeral': [JSON.stringify({ ok: true })],
      '/contents/polls/weekly.json': [ghPollBody({ name: 'Weekly Sports Poll', options: ['Soccer', 'Basketball'] })],
    });

    const env = makeEnv();
    const payload = {
      type: 'view_submission',
      user: { id: 'U_USER' },
      view: {
        callback_id: 'post_results',
        private_metadata: JSON.stringify({ channel_id: 'C_CHAN', user_id: 'U_USER' }),
        state: {
          values: {
            poll_select: {
              value: {
                selected_option: {
                  value: 'weekly',
                  text: { type: 'plain_text', text: 'Weekly Sports Poll' },
                },
              },
            },
          },
        },
      },
    };

    const res = await worker.fetch(makeInteractionRequest(payload), env, env._ctx);
    assert.equal(res.status, 200);
    await env._ctx.flush();

    const dispatchCall = fetchCalls.find(call => call.url.includes('/actions/workflows/post_results.yml/dispatches'));
    assert.ok(dispatchCall, 'expected a post_results workflow dispatch');
    const body = JSON.parse(dispatchCall.opts.body);
    assert.equal(body.inputs.poll_name, 'weekly');
    assert.equal(body.inputs.channel_id, 'C_CHAN');
  });

  test('editing the weekly poll is allowed for the admin', async () => {
    mockFetch({
      '/contents/polls/weekly.json': [ghPollBody({
        name: 'Weekly Sports Poll',
        options: ['Soccer', 'Basketball'],
        emojis: ['soccer', 'basketball'],
        preamble: 'What sporting event should we do this week???',
      })],
    });

    const payload = {
      type: 'view_submission',
      user: { id: 'U_ADMIN' },
      view: {
        callback_id: 'select_poll_to_edit',
        private_metadata: JSON.stringify({ channel_id: 'C_CHAN', user_id: 'U_ADMIN' }),
        state: {
          values: {
            poll_select: {
              value: {
                selected_option: { value: 'weekly', text: { type: 'plain_text', text: 'Weekly Sports Poll' } },
              },
            },
          },
        },
      },
    };

    const res = await worker.fetch(makeInteractionRequest(payload), makeEnv(), {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.response_action, 'push');
    assert.equal(body.view.callback_id, 'edit_poll');
    assert.match(body.view.blocks[0].elements[0].text, /Weekly Sports Poll/);
  });

  test('edit selector preselects previous-winner exclusion when enabled', async () => {
    mockFetch({
      '/contents/polls/weekly.json': [ghPollBody({
        name: 'Weekly Sports Poll',
        options: ['Soccer', 'Basketball'],
        emojis: ['soccer', 'basketball'],
        exclude_previous_winner: true,
      })],
    });

    const payload = {
      type: 'view_submission',
      user: { id: 'U_ADMIN' },
      view: {
        callback_id: 'select_poll_to_edit',
        private_metadata: JSON.stringify({ channel_id: 'C_CHAN', user_id: 'U_ADMIN' }),
        state: {
          values: {
            poll_select: {
              value: {
                selected_option: { value: 'weekly', text: { type: 'plain_text', text: 'Weekly Sports Poll' } },
              },
            },
          },
        },
      },
    };

    const res = await worker.fetch(makeInteractionRequest(payload), makeEnv(), {});
    const body = await res.json();
    const block = body.view.blocks.find(b => b.block_id === 'exclude_previous_winner');
    assert.equal(block.element.initial_options[0].value, 'exclude');
  });
});

describe('poll create and edit persistence', () => {
  test('create_poll persists exclude_previous_winner when selected', async () => {
    const fetchCalls = [];
    globalThis.fetch = async (url, opts = {}) => {
      fetchCalls.push({ url: url.toString(), opts });
      const urlStr = url.toString();
      if (urlStr.includes('/contents/polls/company-games.json') && (!opts.method || opts.method === 'GET')) {
        return new Response('{}', { status: 404 });
      }
      if (urlStr.includes('/contents/polls/company-games.json') && opts.method === 'PUT') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (urlStr.includes('chat.postEphemeral')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };

    const env = makeEnv({ ADMIN_USER_ID: 'U_ADMIN' });
    const payload = {
      type: 'view_submission',
      user: { id: 'U_ADMIN' },
      view: {
        callback_id: 'create_poll',
        private_metadata: JSON.stringify({ channel_id: 'C_CHAN', user_id: 'U_ADMIN' }),
        state: {
          values: {
            poll_name: { value: { value: 'Company Games' } },
            poll_preamble: { value: { value: 'Pick one' } },
            poll_options: { value: { value: ':soccer: Soccer\n:basketball: Basketball' } },
            poll_description: { value: { value: '' } },
            voting_mode: { voting_mode_select: { selected_option: { value: 'reaction' } } },
            exclude_previous_winner: { value: { selected_options: [{ value: 'exclude' }] } },
          },
        },
      },
    };

    const res = await worker.fetch(makeInteractionRequest(payload), env, env._ctx);
    assert.equal(res.status, 200);
    await env._ctx.flush();

    const putCall = fetchCalls.find(call => call.url.includes('/contents/polls/company-games.json') && call.opts?.method === 'PUT');
    assert.ok(putCall, 'expected poll file to be created');
    const pollData = decodeGitHubContent(putCall.opts.body);
    assert.equal(pollData.exclude_previous_winner, true);
  });

  test('edit_poll persists exclude_previous_winner when selected', async () => {
    const calls = [];
    globalThis.fetch = async (url, opts = {}) => {
      calls.push({ url: url.toString(), opts });
      const urlStr = url.toString();
      if (urlStr.includes('/contents/polls/weekly.json') && (!opts.method || opts.method === 'GET')) {
        return new Response(JSON.stringify({
          sha: 'abc123',
          content: toBase64(JSON.stringify({
            name: 'Weekly Sports Poll',
            options: ['Soccer', 'Basketball'],
            emojis: ['soccer', 'basketball'],
          })),
        }), { status: 200 });
      }
      if (urlStr.includes('/contents/polls/weekly.json') && opts.method === 'PUT') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (urlStr.includes('chat.postEphemeral')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };

    const env = makeEnv({ ADMIN_USER_ID: 'U_ADMIN' });
    const payload = {
      type: 'view_submission',
      user: { id: 'U_ADMIN' },
      view: {
        callback_id: 'edit_poll',
        private_metadata: JSON.stringify({ slug: 'weekly', channel_id: 'C_CHAN' }),
        state: {
          values: {
            poll_preamble: { value: { value: 'Pick one' } },
            poll_options: { value: { value: ':soccer: Soccer\n:basketball: Basketball' } },
            poll_description: { value: { value: '' } },
            voting_mode: { edit_voting_mode_select: { selected_option: { value: 'reaction' } } },
            exclude_previous_winner: { value: { selected_options: [{ value: 'exclude' }] } },
          },
        },
      },
    };

    const res = await worker.fetch(makeInteractionRequest(payload), env, env._ctx);
    assert.equal(res.status, 200);
    await env._ctx.flush();

    const putCall = calls.find(call => call.url.includes('/contents/polls/weekly.json') && call.opts?.method === 'PUT');
    assert.ok(putCall, 'expected poll file update');
    const body = JSON.parse(putCall.opts.body);
    const pollData = JSON.parse(atob(body.content));
    assert.equal(pollData.exclude_previous_winner, true);
  });
});
