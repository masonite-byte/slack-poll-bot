package poll

import (
	"fmt"

	"github.com/slack-go/slack"
)

// WeeklyPoll returns the raw text formatting for the weekly poll question
func WeeklyPoll() string {
	return fmt.Sprintf(
		"📊 *Weekly Poll*\n\nWhat should we do this week?\n\n👍 Option A\n🎉 Option B\n🚀 Option C\n",
	)
}

// WeeklyPollBlocks returns Block Kit blocks for the weekly poll.
func WeeklyPollBlocks() []slack.Block {
	headerText := slack.NewTextBlockObject("mrkdwn", "*📊 Weekly Poll*", false, false)
	header := slack.NewSectionBlock(headerText, nil, nil)

	promptText := slack.NewTextBlockObject("mrkdwn", "What should we do this week?\n\nReact with one of the options below:", false, false)
	prompt := slack.NewSectionBlock(promptText, nil, nil)

	optionA := slack.NewSectionBlock(slack.NewTextBlockObject("mrkdwn", ":+1: Option A", false, false), nil, nil)
	optionB := slack.NewSectionBlock(slack.NewTextBlockObject("mrkdwn", ":tada: Option B", false, false), nil, nil)
	optionC := slack.NewSectionBlock(slack.NewTextBlockObject("mrkdwn", ":rocket: Option C", false, false), nil, nil)

	marker := slack.NewContextBlock("poll_marker",
		slack.NewTextBlockObject("mrkdwn", "poll_marker:weekly", false, false),
	)

	return []slack.Block{header, prompt, optionA, optionB, optionC, marker}
}
