package main

import (
	"log/slog"
	"net/http"
	"os"

	"github.com/joho/godotenv"
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
	"github.com/masonite-byte/slack-poll-bot/internal/slackserver"
)

func main() {
	_ = godotenv.Load()
	signingSecret := os.Getenv("SLACK_SIGNING_SECRET")
	if signingSecret == "" {
		slog.Error("missing required env var: SLACK_SIGNING_SECRET")
		os.Exit(1)
	}

	client := slackclient.New()
	server := slackserver.New(client, signingSecret)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.Handle("/slack/commands", server.Handler())
	slog.Info("starting Slack command server", "port", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}
