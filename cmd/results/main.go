package main

import (
	"errors"
	"log/slog"
	"os"

	"github.com/joho/godotenv"
	"github.com/masonite-byte/slack-poll-bot/internal/runner"
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
)

func main() {
	_ = godotenv.Load()
	client := slackclient.New()
	if pollName := os.Getenv("POLL_NAME"); pollName != "" {
		if err := runner.RunResultsForSlug(client, pollName); err != nil {
			if errors.Is(err, runner.ErrNoPollFound) {
				slog.Warn("no active poll found for slug, nothing to do", "poll_name", pollName)
				os.Exit(0)
			}
			slog.Error("error computing results for poll", "poll_name", pollName, "error", err)
			os.Exit(1)
		}
		return
	}
	_, isTie, err := runner.RunResults(client)
	if err != nil {
		if errors.Is(err, runner.ErrNoPollFound) {
			slog.Warn("no active poll found, nothing to do")
			os.Exit(0)
		}
		slog.Error("error computing results", "error", err)
		os.Exit(1)
	}

	// Notify voters before posting runoff so FindLatestPoll still finds the original poll
	if err := runner.NotifyVoters(client); err != nil {
		slog.Error("error notifying voters", "error", err)
		os.Exit(1)
	}

	if isTie {
		// RunoffPoll deletes the original poll itself before posting the runoff.
		result, err := runner.RunoffPoll(client)
		if err != nil {
			slog.Error("error posting runoff poll", "error", err)
			os.Exit(1)
		}
		slog.Info("runoff poll posted", "result", result)
	} else {
		if _, err := runner.DeleteLatestPoll(client); err != nil {
			slog.Warn("could not delete poll after results", "error", err)
		}
	}
}
