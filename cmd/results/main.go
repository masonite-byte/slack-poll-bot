package main

import (
	"log"

	"github.com/masonite-byte/slack-poll-bot/internal/runner"
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
)

func main() {
	client := slackclient.New()
	if _, err := runner.RunResults(client); err != nil {
		log.Fatalf("Error computing results: %v", err)
	}
}
