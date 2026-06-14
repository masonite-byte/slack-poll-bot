package main

import (
	"log/slog"
	"os"
	"time"

	"github.com/masonite-byte/slack-poll-bot/internal/runner"
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
)

func main() {
	client := slackclient.New()
	_, isTie, err := runner.RunResults(client)
	if err != nil {
		slog.Error("error computing results", "error", err)
		os.Exit(1)
	}

	if isTie {
		slog.Info("tie detected, waiting before posting runoff poll")
		time.Sleep(5 * time.Minute)
		if _, err := runner.RunoffPoll(client); err != nil {
			slog.Error("runoff poll failed", "error", err)
			os.Exit(1)
		}
	}
}
