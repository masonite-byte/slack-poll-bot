package main

import (
	"encoding/json"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/masonite-byte/slack-poll-bot/internal/poll"
	"github.com/masonite-byte/slack-poll-bot/internal/runner"
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
)

var stateFile = "polls/_schedule_state.json"

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

		if p.Schedule == "" || !isDue(p.Schedule, now) || state[slug] == today {
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

		slog.Info("posting scheduled poll", "slug", slug, "schedule", p.Schedule)
		os.Setenv("SLACK_CHANNEL_ID", channelID)
		client := slackclient.New()

		if err := runner.RunPostCustomPoll(client, p); err != nil {
			slog.Error("failed to post scheduled poll", "slug", slug, "error", err)
			continue
		}

		state[slug] = today
		posted = true
	}

	if posted {
		if err := saveState(state); err != nil {
			slog.Error("failed to save schedule state", "error", err)
		}
	}
}

// isDue returns true if now matches the poll's schedule string.
// Supported format: "weekday HH:MM" or "weekday HH:MM CT" (e.g. "monday 09:00").
func isDue(schedule string, now time.Time) bool {
	parts := strings.Fields(strings.ToLower(schedule))
	if len(parts) < 2 {
		return false
	}

	wd, ok := map[string]time.Weekday{
		"sunday": time.Sunday, "monday": time.Monday, "tuesday": time.Tuesday,
		"wednesday": time.Wednesday, "thursday": time.Thursday,
		"friday": time.Friday, "saturday": time.Saturday,
	}[parts[0]]
	if !ok || now.Weekday() != wd {
		return false
	}

	hm := strings.SplitN(parts[1], ":", 2)
	if len(hm) != 2 {
		return false
	}
	hour, err := strconv.Atoi(hm[0])
	return err == nil && now.Hour() == hour
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
