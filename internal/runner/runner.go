package runner

import (
	"fmt"
	"strings"

	"github.com/masonite-byte/slack-poll-bot/internal/poll"
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
)

// RunPostPoll posts the poll and seeds initial reactions using the provided API.
func RunPostPoll(api slackclient.API) error {
	msg := poll.WeeklyPoll()
	blocks := poll.WeeklyPollBlocks()
	_, timestamp, err := api.PostBlocks(msg, blocks...)
	if err != nil {
		return err
	}

	emojis := []string{"thumbsup", "tada", "rocket"}
	for _, e := range emojis {
		_ = api.AddReaction(e, timestamp)
	}
	return nil
}

// RunResults finds the latest poll, computes vote counts (excluding bot), and posts the summary.
func RunResults(api slackclient.API) (string, error) {
	timestamp, err := api.FindLatestPoll()
	if err != nil {
		return "", err
	}

	reactions, err := api.GetReactions(timestamp)
	if err != nil {
		return "", err
	}

	botID, _ := api.BotUserID()

	var reportLines []string
	reportLines = append(reportLines, "📊 *Final Poll Results Are In!* \n")

	for _, reaction := range reactions {
		voterCount := reaction.Count
		for _, u := range reaction.Users {
			if u == botID {
				voterCount--
				break
			}
		}
		if voterCount < 0 {
			voterCount = 0
		}
		reportLines = append(reportLines, fmt.Sprintf(":%s: received %d votes", reaction.Name, voterCount))
	}

	finalMessage := strings.Join(reportLines, "\n")
	_, _, _ = api.PostMessage(finalMessage)
	return finalMessage, nil
}
