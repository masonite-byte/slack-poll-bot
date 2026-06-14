package main

import (
	"log"
	"net/http"
	"os"

	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
	"github.com/masonite-byte/slack-poll-bot/internal/slackserver"
)

func main() {
	signingSecret := os.Getenv("SLACK_SIGNING_SECRET")
	if signingSecret == "" {
		log.Fatal("missing required env var: SLACK_SIGNING_SECRET")
	}

	client := slackclient.New()
	server := slackserver.New(client, signingSecret)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.Handle("/slack/commands", server.Handler())
	log.Printf("starting Slack command server on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
