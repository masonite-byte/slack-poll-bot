package runner

import (
	"fmt"
	"log/slog"
	"sort"
	"strings"

	"github.com/masonite-byte/slack-poll-bot/internal/poll"
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
)

type pollResult struct {
	Name  string
	Label string
	Count int
}

// RunPostPoll posts the poll and seeds initial reactions using the provided API.
func RunPostPoll(api slackclient.API) error {
	instance := poll.GetWeeklyPoll()
	blocks := poll.WeeklyPollBlocks()
	_, timestamp, err := api.PostBlocks(instance.Text, blocks...)
	if err != nil {
		return err
	}

	for _, e := range instance.Emojis {
		if err := api.AddReaction(e, timestamp); err != nil {
			slog.Warn("failed to seed reaction", "emoji", e, "error", err)
		}
	}
	return nil
}

// RunResults finds the latest poll, computes vote counts (excluding bot), posts the summary,
// and returns the message and whether the top options are tied.
func RunResults(api slackclient.API) (string, bool, error) {
	timestamp, err := api.FindLatestPoll()
	if err != nil {
		return "", false, err
	}

	reactions, err := api.GetReactions(timestamp)
	if err != nil {
		return "", false, err
	}

	botID, err := api.BotUserID()
	if err != nil {
		return "", false, err
	}

	message := BuildResults(reactions, botID)
	_, _, _ = api.PostMessage(message)

	results := tallyResults(reactions, botID)
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

	isTie := maxCount > 0 && len(winning) > 1
	return message, isTie, nil
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
	results := tallyResults(reactions, botID)

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

func BuildPollStatusMessage(api slackclient.API) (string, error) {
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

	summary := BuildResults(reactions, botID)
	return fmt.Sprintf("Current poll status (posted at %s):\n%s", timestamp, summary), nil
}

func RunoffPoll(api slackclient.API) (string, error) {
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

	results := tallyResults(reactions, botID)
	if len(results) == 0 {
		return "No votes have been cast yet. Runoff requires at least one vote.", nil
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
		return "No votes have been cast yet. Runoff requires at least one vote.", nil
	}
	if len(winning) < 2 {
		return fmt.Sprintf("No runoff required. Current leader is %s.", winning[0]), nil
	}

	blocks := poll.RunoffPollBlocks(winning)
	_, timestamp, err = api.PostBlocks("📊 Runoff Poll", blocks...)
	if err != nil {
		return "", err
	}

	for _, option := range winning {
		reaction, ok := poll.OptionReactions[option]
		if ok {
			if err := api.AddReaction(reaction, timestamp); err != nil {
				slog.Warn("failed to seed runoff reaction", "emoji", reaction, "error", err)
			}
		}
	}

	return fmt.Sprintf("Runoff poll posted with tied options: %s.", strings.Join(winning, ", ")), nil
}

func BuildHelpText() string {
	return strings.Join([]string{
		"Supported slash commands:",
		"/results - show the current poll results.",
		"/recount - rerun the current poll tally.",
		"/pollstatus - show the current poll status and counts.",
		"/newpoll - post a new poll message.",
		"/runoff - start a runoff poll when the latest poll is tied.",
		"/options - list poll options and emoji.",
		"/vote - instructions for voting via emoji reactions.",
		"/help - show this help text.",
	}, "\n")
}

func BuildOptionsText() string {
	return "Available poll options:\n" + poll.PollOptionsText()
}

func BuildVoteHelpText() string {
	return strings.Join([]string{
		"Vote by reacting to the current poll message with one of the following emojis:",
		poll.PollOptionsText(),
		"Use /results to check the current tally.",
	}, "\n")
}

func tallyResults(reactions []slackclient.Reaction, botID string) []pollResult {
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
		label, ok := poll.ReactionLabels[reaction.Name]
		if !ok {
			label = reaction.Name
		}
		results = append(results, pollResult{Name: reaction.Name, Label: label, Count: count})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Label < results[j].Label
	})
	return results
}
