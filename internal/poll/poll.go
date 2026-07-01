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
// emojiMap is an optional option→emoji mapping from the original poll's JSON; falls back to OptionReactions then slugify.
func GetRunoffPoll(options []string, emojiMap map[string]string) PollInstance {
	text := "📊 *Runoff Poll*\n@channel: A tie was detected. Vote again for the final winner:"
	emojis := make([]string, 0, len(options))
	for _, opt := range options {
		reaction := reactionForOption(opt, emojiMap)
		text += fmt.Sprintf("\n    :%s: %s", reaction, opt)
		emojis = append(emojis, reaction)
	}
	return PollInstance{Text: text, Emojis: emojis}
}

// RunoffPollBlocks returns a Block Kit poll with the given tied option labels.
// emojiMap is an optional option→emoji mapping from the original poll's JSON.
func RunoffPollBlocks(options []string, emojiMap map[string]string) []slack.Block {
	return BuildPollBlocks(
		"Runoff Poll",
		"@channel: A tie was detected. Vote again for the final winner:",
		"runoff",
		options,
		emojiMap,
	)
}

// BuildPollBlocks constructs generic Block Kit blocks for a poll.
// emojiMap is an optional option→emoji mapping; falls back to OptionReactions then slugify.
func BuildPollBlocks(title, prompt, marker string, options []string, emojiMap map[string]string) []slack.Block {
	headerText := slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("*📊 %s*", title), false, false)
	header := slack.NewSectionBlock(headerText, nil, nil)

	promptText := slack.NewTextBlockObject("mrkdwn", prompt, false, false)
	promptSection := slack.NewSectionBlock(promptText, nil, nil)

	blocks := []slack.Block{header, promptSection}
	for _, option := range options {
		reaction := reactionForOption(option, emojiMap)
		blocks = append(blocks, slack.NewSectionBlock(
			slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("    :%s: %s", reaction, option), false, false),
			nil,
			nil,
		))
	}

	blocks = append(blocks, adminDeleteActionBlock())

	markerBlock := slack.NewContextBlock("poll_marker",
		slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("poll_marker:%s", marker), false, false),
	)
	blocks = append(blocks, markerBlock)

	return blocks
}

func adminDeleteActionBlock() *slack.ActionBlock {
	btn := slack.NewButtonBlockElement(
		"admin_delete_message",
		"delete_message",
		slack.NewTextBlockObject("plain_text", "Admin Delete", false, false),
	)
	btn.Style = "danger"
	return slack.NewActionBlock("admin_delete_message_actions", btn)
}

// reactionForOption resolves the emoji name for an option. Checks emojiMap first,
// then the hardcoded OptionReactions table, then falls back to a slugified name.
func reactionForOption(option string, emojiMap map[string]string) string {
	if emojiMap != nil {
		if reaction, ok := emojiMap[option]; ok {
			return reaction
		}
	}
	if reaction, ok := OptionReactions[option]; ok {
		return reaction
	}
	return strings.ToLower(strings.ReplaceAll(option, " ", "_"))
}
