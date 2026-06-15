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
	if err := runner.NotifyVoters(client); err != nil {
		slog.Error("notify voters failed", "error", err)
		os.Exit(1)
	}
	slog.Info("voters notified")
}
