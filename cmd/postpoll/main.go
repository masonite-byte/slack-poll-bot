package main

import (
	"log/slog"
	"os"

	"github.com/masonite-byte/slack-poll-bot/internal/runner"
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
)

func main() {
	client := slackclient.New()
	if err := runner.RunPostPoll(client); err != nil {
		slog.Error("Error posting poll", "error", err)
		os.Exit(1)
	}
}
