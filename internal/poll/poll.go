package poll

import (
	"fmt"
	"strings"

	"github.com/slack-go/slack"
)

var (
	OptionReactions = map[string]string{
		"Option A": "+1",
		"Option B": "tada",
		"Option C": "rocket",
	}

	ReactionLabels = map[string]string{
		"thumbsup": "Option A",
		"+1":       "Option A",
		"tada":     "Option B",
		"rocket":   "Option C",
	}

	DefaultPollOptions = []string{"Option A", "Option B", "Option C"}
)

// WeeklyPoll returns the raw text formatting for the weekly poll question.
func WeeklyPoll() string {
	return fmt.Sprintf(
		"📊 *Weekly Poll*\n\nWhat should we do this week?\n\n👍 Option A\n🎉 Option B\n🚀 Option C\n",
	)
}

// WeeklyPollBlocks returns Block Kit blocks for the weekly poll.
func WeeklyPollBlocks() []slack.Block {
	return BuildPollBlocks(
		"Weekly Poll",
		"What should we do this week?\n\nReact with one of the options below:",
		"weekly",
		DefaultPollOptions,
	)
}

// RunoffPollBlocks returns a Block Kit poll with the given tied option labels.
func RunoffPollBlocks(options []string) []slack.Block {
	return BuildPollBlocks(
		"Runoff Poll",
		"A tie was detected. Vote again for the final winner:",
		"runoff",
		options,
	)
}

// BuildPollBlocks constructs generic Block Kit blocks for a poll.
func BuildPollBlocks(title, prompt, marker string, options []string) []slack.Block {
	headerText := slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("*📊 %s*", title), false, false)
	header := slack.NewSectionBlock(headerText, nil, nil)

	promptText := slack.NewTextBlockObject("mrkdwn", prompt, false, false)
	promptSection := slack.NewSectionBlock(promptText, nil, nil)

	blocks := []slack.Block{header, promptSection}
	for _, option := range options {
		reaction, ok := OptionReactions[option]
		if !ok {
			reaction = strings.ToLower(strings.ReplaceAll(option, " ", "_"))
		}
		blocks = append(blocks, slack.NewSectionBlock(
			slack.NewTextBlockObject("mrkdwn", fmt.Sprintf(":%s: %s", reaction, option), false, false),
			nil,
			nil,
		))
	}

	markerBlock := slack.NewContextBlock("poll_marker",
		slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("poll_marker:%s", marker), false, false),
	)
	blocks = append(blocks, markerBlock)

	return blocks
}

// PollOptionsText returns the poll option list for help and commands.
func PollOptionsText() string {
	lines := make([]string, 0, len(DefaultPollOptions))
	for _, option := range DefaultPollOptions {
		if emoji, ok := OptionReactions[option]; ok {
			lines = append(lines, fmt.Sprintf(":%s: %s", emoji, option))
		} else {
			lines = append(lines, option)
		}
	}
	return strings.Join(lines, "\n")
}
