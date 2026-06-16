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

	DefaultPollOptions = []string{"Soccer", "Basketball", "Ultimate Frisbee", "Volleyball", "Hackeysack", "Other?????"}
)

func weeklyPoll() string {
	poll := fmt.Sprintf("@channel: 📊 *Weekly Poll*\n\nWhat sporting event should we do this week???")
	for _, option := range DefaultPollOptions {
		if emoji, ok := OptionReactions[option]; ok {
			poll += fmt.Sprintf("\n    :%s: %s", emoji, option)
		} else {
			poll += fmt.Sprintf("\n Error generating this option: %s", option)
		}
	}
	return poll
}

// PollInstance represents a poll's fallback text and the emoji reactions used to seed it.
type PollInstance struct {
	Text   string
	Emojis []string
}

func filteredOptions(excluded string) []string {
	options := make([]string, 0, len(DefaultPollOptions))
	for _, opt := range DefaultPollOptions {
		if opt != excluded {
			options = append(options, opt)
		}
	}
	return options
}

// GetWeeklyPoll returns a structured weekly poll including the text and emojis.
func GetWeeklyPoll() PollInstance {
	text := weeklyPoll()
	emojis := make([]string, 0, len(DefaultPollOptions))
	for _, opt := range DefaultPollOptions {
		if r, ok := OptionReactions[opt]; ok {
			emojis = append(emojis, r)
		} else {
			emojis = append(emojis, strings.ToLower(strings.ReplaceAll(opt, " ", "_")))
		}
	}
	return PollInstance{Text: text, Emojis: emojis}
}

// GetWeeklyPollExcluding returns a weekly poll with the given option removed.
func GetWeeklyPollExcluding(excluded string) PollInstance {
	options := filteredOptions(excluded)
	text := fmt.Sprintf("@channel: 📊 *Weekly Poll*\n\nWhat sporting event should we do this week???")
	for _, opt := range options {
		if emoji, ok := OptionReactions[opt]; ok {
			text += fmt.Sprintf("\n    :%s: %s", emoji, opt)
		}
	}
	emojis := make([]string, 0, len(options))
	for _, opt := range options {
		if r, ok := OptionReactions[opt]; ok {
			emojis = append(emojis, r)
		} else {
			emojis = append(emojis, strings.ToLower(strings.ReplaceAll(opt, " ", "_")))
		}
	}
	return PollInstance{Text: text, Emojis: emojis}
}

// WeeklyPollBlocksExcluding returns Block Kit blocks for a weekly poll with one option excluded.
func WeeklyPollBlocksExcluding(excluded string) []slack.Block {
	return BuildPollBlocks(
		"Weekly Poll",
		fmt.Sprintf("@channel: What sporting event should we do this week???\n\n_(Last week's winner, %s, is excluded.)_\n\nReact with one of the options below:", excluded),
		"weekly",
		filteredOptions(excluded),
	)
}

// GetRunoffPoll returns a structured runoff poll including fallback text and emojis for the given options.
func GetRunoffPoll(options []string) PollInstance {
	text := "📊 *Runoff Poll*\n@channel: A tie was detected. Vote again for the final winner:"
	emojis := make([]string, 0, len(options))
	for _, opt := range options {
		reaction, ok := OptionReactions[opt]
		if !ok {
			reaction = strings.ToLower(strings.ReplaceAll(opt, " ", "_"))
		}
		text += fmt.Sprintf("\n    :%s: %s", reaction, opt)
		emojis = append(emojis, reaction)
	}
	return PollInstance{Text: text, Emojis: emojis}
}

// WeeklyPollBlocks returns Block Kit blocks for the weekly poll.
func WeeklyPollBlocks() []slack.Block {
	return BuildPollBlocks(
		"Weekly Poll",
		"@channel: What sporting event should we do this week???\n\nReact with one of the options below:",
		"weekly",
		DefaultPollOptions,
	)
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
		reaction, ok := OptionReactions[option]
		if !ok {
			reaction = strings.ToLower(strings.ReplaceAll(option, " ", "_"))
		}
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
