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
	_, _, err := runner.RunResults(client)
	if err != nil {
		slog.Error("error computing results", "error", err)
		os.Exit(1)
	}

	if err := runner.NotifyVoters(client); err != nil {
		slog.Error("error notifying voters", "error", err)
		os.Exit(1)
	}
}
