package main

import (
	"log/slog"
	"os"

	"github.com/masonite-byte/slack-poll-bot/internal/runner"
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
)

func main() {
	// Note: `slackclient.Client` stores the configured channel ID on creation.
	// Use `client.GetReactions(timestamp)` (only timestamp) — do not pass
	// `os.Getenv("SLACK_CHANNEL_ID")` as the first argument; the client
	// already knows the channel.
	client := slackclient.New()
	if _, err := runner.RunResults(client); err != nil {
		slog.Error("Error computing results", "error", err)
		os.Exit(1)
	}
}
