package main

import (
    "fmt"
    "log"
    "strings"

    "github.com/masonite-byte/slack-poll-bot/internal/slackclient"
)

func main() {
    client := slackclient.New()

    fmt.Println("Searching for Monday's poll...")
    // 1. Audit channel history to locate the active poll timestamp
    timestamp, err := client.FindLatestPoll()
    if err != nil {
        log.Fatalf("Execution halted: Could not locate recent poll context: %v", err)
    }

    // 2. Fetch the aggregate reactions from that message
    reactions, err := client.GetReactions(timestamp)
    if err != nil {
        log.Fatalf("Error pulling reaction maps: %v", err)
    }

    // 3. Parse reaction metrics
    var reportLines []string
    reportLines = append(reportLines, "📊 *Final Poll Results Are In!* \n")

    for _, reaction := range reactions {
        // Subtracting 1 removes the bot's own seed reaction from the total vote tally
        voterCount := reaction.Count - 1
        if voterCount < 0 {
            voterCount = 0
        }
        reportLines = append(reportLines, fmt.Sprintf(":%s: received %d votes", reaction.Name, voterCount))
    }

    // 4. Construct final summary string and publish to channel
    finalMessage := strings.Join(reportLines, "\n")
    _, _, err = client.PostMessage(finalMessage)
    if err != nil {
        log.Fatalf("Failed to post computed summary: %v", err)
    }

    fmt.Println("Successfully calculated totals and posted results back to Slack!")
}
