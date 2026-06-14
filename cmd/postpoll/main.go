package main

import (
    "fmt"
    "log"

    "github.com/masonite-byte/slack-poll-bot/internal/poll"
    "github.com/masonite-byte/slack-poll-bot/internal/slackclient"
)

func main() {
    client := slackclient.New()

    // 1. Generate the message layout
    msg := poll.WeeklyPoll()

    // 2. Dispatch to Slack
    channel, timestamp, err := client.PostMessage(msg)
    if err != nil {
        log.Fatalf("Error posting poll message: %v", err)
    }

    fmt.Printf("Posted poll to channel %s at TS: %s\n", channel, timestamp)

    // 3. Seed the initial reactions so users can easily tap to click-vote
    votingEmojis := []string{"thumbsup", "tada", "rocket"}
    for _, emoji := range votingEmojis {
        err := client.AddReaction(emoji, timestamp)
        if err != nil {
            log.Printf("Warning: Failed to add reaction ':%s:': %v", emoji, err)
        }
    }
    fmt.Println("Successfully seeded voting emoji options!")
}
