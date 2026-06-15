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
	_, isTie, err := runner.RunResults(client)
	if err != nil {
		slog.Error("error computing results", "error", err)
		os.Exit(1)
	}

	// Notify voters before posting runoff so FindLatestPoll still finds the original poll
	if err := runner.NotifyVoters(client); err != nil {
		slog.Error("error notifying voters", "error", err)
		os.Exit(1)
	}

	if isTie {
		result, err := runner.RunoffPoll(client)
		if err != nil {
			slog.Error("error posting runoff poll", "error", err)
			os.Exit(1)
		}
		slog.Info("runoff poll posted", "result", result)
	}
}
