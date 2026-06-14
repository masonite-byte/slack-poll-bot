# Slack Poll Bot

A very scrumtilidicious solution to remove a little responsibility from humans via enslaving robots. (In other words: Automated Slack polling bot using Go and GitHub Actions)
Automated stateless Slack poll system using Go + GitHub Actions.

## Capabilities
- Automates weekly poll distributions via Cron (Mondays)
- Statelessly discovers and parses reaction-based votes from active threads
- Publishes standalone poll metrics (Wednesdays)

## Initialization Requirements

1. Register a dedicated app instance via [api.slack.com](https://api.slack.com/apps).
2. Assign the following **Bot Token Scopes** under "OAuth & Permissions":
	- `chat:write` 
	- `reactions:write`
	- `reactions:read`
	- `channels:history`
3. Install the application to your target workspace and copy the generated token string (`xoxb-...`).
4. Inject your environment values into your GitHub Repository under **Settings > Secrets and variables > Actions**:
	- `SLACK_BOT_TOKEN`
	- `SLACK_CHANNEL_ID`
	- `SLACK_SIGNING_SECRET`

## Local Execution

Copy `.env.example` to `.env` and export values, then run:

```bash
# Post Monday Poll
go run ./cmd/postpoll

# Process Wednesday Results
go run ./cmd/results

# Run the slash command server for /results
go run ./cmd/server
```

## Slack Slash Command Setup

1. In your Slack app, create a slash command with the Request URL set to your server endpoint, for example `https://<host>/slack/commands`.
2. Use `SLACK_SIGNING_SECRET` from your Slack app to validate requests.
3. The bot supports these commands:
   - `/results` - show the current poll results.
   - `/recount` - rerun the current poll tally.
   - `/pollstatus` - show the current poll status and counts.
   - `/newpoll` - post a new poll message.
   - `/runoff` - start a runoff poll when the latest poll is tied.
   - `/options` - list poll options and emoji.
   - `/vote` - show voting instructions.
   - `/help` - show this help text.
4. When a supported command is invoked, the bot responds ephemerally and may also post or update poll content in the channel.
# slack-poll-bot
A very scrumtilidicious solution to remove a little responsibility from humans via enslaving robots. (In other words: Automated Slack polling bot using Go and GitHub Actions)
