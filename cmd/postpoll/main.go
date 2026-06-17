package main

import (
	"log/slog"
	"os"

	"github.com/joho/godotenv"
	"github.com/masonite-byte/slack-poll-bot/internal/poll"
	"github.com/masonite-byte/slack-poll-bot/internal/runner"
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
)

func main() {
	_ = godotenv.Load()
	client := slackclient.New()

	if pollName := os.Getenv("POLL_NAME"); pollName != "" {
		customPoll, err := poll.LoadCustomPoll(pollName)
		if err != nil {
			slog.Error("failed to load custom poll", "name", pollName, "error", err)
			os.Exit(1)
		}
		if err := runner.RunPostCustomPoll(client, customPoll); err != nil {
			slog.Error("error posting custom poll", "error", err)
			os.Exit(1)
		}
		return
	}

	if err := runner.RunPostPoll(client); err != nil {
		slog.Error("error posting poll", "error", err)
		os.Exit(1)
	}
}
