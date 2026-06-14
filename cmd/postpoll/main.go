package main

import (
	"log"

	"github.com/masonite-byte/slack-poll-bot/internal/runner"
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
)

func main() {
	client := slackclient.New()
	if err := runner.RunPostPoll(client); err != nil {
		log.Fatalf("Error posting poll: %v", err)
	}
}
