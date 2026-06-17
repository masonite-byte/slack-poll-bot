package main

import (
	"log/slog"
	"os"

	"github.com/joho/godotenv"
	"github.com/masonite-byte/slack-poll-bot/internal/runner"
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
)

func main() {
	_ = godotenv.Load()
	client := slackclient.New()
	result, err := runner.RunoffPoll(client)
	if err != nil {
		slog.Error("runoff failed", "error", err)
		os.Exit(1)
	}
	slog.Info("runoff complete", "result", result)
}
