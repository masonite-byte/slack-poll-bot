package main

import (
	"encoding/json"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/masonite-byte/slack-poll-bot/internal/poll"
	"github.com/masonite-byte/slack-poll-bot/internal/runner"
	"github.com/masonite-byte/slack-poll-bot/internal/schedule"
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
)

var stateFile = "polls/_results_state.json"

func main() {
	_ = godotenv.Load()

	chicagoTZ, err := time.LoadLocation("America/Chicago")
	if err != nil {
		slog.Error("failed to load timezone", "error", err)
		os.Exit(1)
	}

	now := time.Now().In(chicagoTZ)
	today := now.Format("2006-01-02")
	state := loadState()

	entries, err := os.ReadDir("polls")
	if err != nil {
		slog.Error("failed to read polls directory", "error", err)
		os.Exit(1)
	}

	defaultChannel := os.Getenv("SLACK_CHANNEL_ID")
	posted := false

	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".json") || strings.HasPrefix(name, "_") {
			continue
		}

		slug := strings.TrimSuffix(name, ".json")
		p, err := poll.LoadCustomPoll(slug)
		if err != nil {
			slog.Warn("skipping poll", "slug", slug, "error", err)
			continue
		}

		if p.ResultsSchedule == "" || !schedule.IsDue(p.ResultsSchedule, now) || state[slug] == today {
			continue
		}

		if p.VotingMode == "button" {
			slog.Info("skipping button poll scheduled results (button polls have live counts)", "slug", slug)
			continue
		}

		channelID := p.ChannelID
		if channelID == "" {
			channelID = defaultChannel
		}
		if channelID == "" {
			slog.Warn("no channel configured for poll, skipping", "slug", slug)
			continue
		}

		slog.Info("posting scheduled results", "slug", slug, "results_schedule", p.ResultsSchedule)
		os.Setenv("SLACK_CHANNEL_ID", channelID)
		client := slackclient.New()

		if err := runner.RunResultsForSlug(client, slug); err != nil {
			slog.Error("failed to post scheduled results", "slug", slug, "error", err)
			continue
		}

		state[slug] = today
		posted = true
	}

	if posted {
		if err := saveState(state); err != nil {
			slog.Error("failed to save results state", "error", err)
		}
	}
}

func loadState() map[string]string {
	data, err := os.ReadFile(stateFile)
	if err != nil {
		return make(map[string]string)
	}
	var m map[string]string
	if json.Unmarshal(data, &m) != nil {
		return make(map[string]string)
	}
	return m
}

func saveState(m map[string]string) error {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(stateFile, data, 0644)
}
