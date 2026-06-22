package poll

import (
	"fmt"
	"strings"

	"github.com/slack-go/slack"
)

var (
	OptionReactions = map[string]string{
		"Soccer":           "soccer",
		"Basketball":       "basketball",
		"Ultimate Frisbee": "flying_disc",
		"Volleyball":       "volleyball",
		"Hackeysack":       "athletic_shoe",
		"Other?????":       "question",
	}

	ReactionLabels = map[string]string{
		"soccer":        "Soccer",
		"basketball":    "Basketball",
		"flying_disc":   "Ultimate Frisbee",
		"volleyball":    "Volleyball",
		"athletic_shoe": "Hackeysack",
		"question":      "Other?????",
	}
)

// PollInstance represents a poll's fallback text and the emoji reactions used to seed it.
type PollInstance struct {
	Text   string
	Emojis []string
}

// GetRunoffPoll returns a structured runoff poll including fallback text and emojis for the given options.
func GetRunoffPoll(options []string) PollInstance {
	text := "📊 *Runoff Poll*\n@channel: A tie was detected. Vote again for the final winner:"
	emojis := make([]string, 0, len(options))
	for _, opt := range options {
		reaction := reactionForOption(opt)
		text += fmt.Sprintf("\n    :%s: %s", reaction, opt)
		emojis = append(emojis, reaction)
	}
	return PollInstance{Text: text, Emojis: emojis}
}

// RunoffPollBlocks returns a Block Kit poll with the given tied option labels.
func RunoffPollBlocks(options []string) []slack.Block {
	return BuildPollBlocks(
		"Runoff Poll",
		"@channel: A tie was detected. Vote again for the final winner:",
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
		reaction := reactionForOption(option)
		blocks = append(blocks, slack.NewSectionBlock(
			slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("    :%s: %s", reaction, option), false, false),
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

func reactionForOption(option string) string {
	if reaction, ok := OptionReactions[option]; ok {
		return reaction
	}
	return strings.ToLower(strings.ReplaceAll(option, " ", "_"))
}
