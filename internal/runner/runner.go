package runner

import (
	"fmt"
	"sort"
	"strings"

	"github.com/masonite-byte/slack-poll-bot/internal/poll"
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
)

var reactionLabel = map[string]string{
	"thumbsup": "Option A",
	"+1":       "Option A",
	"tada":     "Option B",
	"rocket":   "Option C",
}

type pollResult struct {
	Name  string
	Label string
	Count int
}

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

// RunResults finds the latest poll, computes vote counts (excluding bot), posts the summary, and returns the message.
func RunResults(api slackclient.API) (string, error) {
	message, err := BuildResultsMessage(api)
	if err != nil {
		return "", err
	}

	_, _, _ = api.PostMessage(message)
	return message, nil
}

// BuildResultsMessage computes the results summary from Slack and returns the final text.
func BuildResultsMessage(api slackclient.API) (string, error) {
	timestamp, err := api.FindLatestPoll()
	if err != nil {
		return "", err
	}

	reactions, err := api.GetReactions(timestamp)
	if err != nil {
		return "", err
	}

	botID, err := api.BotUserID()
	if err != nil {
		return "", err
	}

	return BuildResults(reactions, botID), nil
}

// BuildResults generates a text report and appends the highest-voted event or tie summary.
func BuildResults(reactions []slackclient.Reaction, botID string) string {
	results := make([]pollResult, 0, len(reactions))
	for _, reaction := range reactions {
		count := reaction.Count
		for _, u := range reaction.Users {
			if u == botID {
				count--
				break
			}
		}
		if count < 0 {
			count = 0
		}
		label, ok := reactionLabel[reaction.Name]
		if !ok {
			label = reaction.Name
		}
		results = append(results, pollResult{Name: reaction.Name, Label: label, Count: count})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Label < results[j].Label
	})

	lines := []string{"📊 *Final Poll Results Are In!*"}
	for _, result := range results {
		lines = append(lines, fmt.Sprintf(":%s: %s received %d votes", result.Name, result.Label, result.Count))
	}

	maxCount := -1
	winning := make([]string, 0)
	for _, result := range results {
		if result.Count > maxCount {
			maxCount = result.Count
			winning = []string{result.Label}
		} else if result.Count == maxCount {
			winning = append(winning, result.Label)
		}
	}

	if maxCount <= 0 {
		lines = append(lines, "No votes have been cast yet.")
	} else if len(winning) == 1 {
		lines = append(lines, fmt.Sprintf("Top event: %s.", winning[0]))
	} else {
		lines = append(lines, fmt.Sprintf("It's a tie between %s.", strings.Join(winning, " and ")))
	}

	return strings.Join(lines, "\n")
}
