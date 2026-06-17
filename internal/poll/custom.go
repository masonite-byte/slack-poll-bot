package poll

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/slack-go/slack"
)

// pollsDir is the directory where custom poll JSON files are stored.
// Overridable in tests.
var pollsDir = "polls"

var numberEmojis = []string{"one", "two", "three", "four", "five", "six", "seven", "eight", "nine"}

// optionLine formats one poll option for Slack mrkdwn.
// Non-breaking spaces (U+00A0) are used for the leading indent so Slack doesn't strip them.
// Long text is pre-wrapped at ~60 chars with a continuation indent so wrapped lines
// don't fall back to the left margin.
func optionLine(emojiName, text string) string {
	const (
		nbsp    = " "
		wrapAt  = 40
		contLen = 11 // 4 leading NBSP + ~6 emoji visual width + 1 space
	)
	leading := strings.Repeat(nbsp, 4)
	cont := strings.Repeat(nbsp, contLen)
	prefix := leading + ":" + emojiName + ": "
	if len([]rune(text)) <= wrapAt {
		return prefix + text
	}
	words := strings.Fields(text)
	var sb strings.Builder
	sb.WriteString(prefix)
	col := 0
	for i, w := range words {
		wlen := len([]rune(w))
		if i == 0 {
			sb.WriteString(w)
			col = wlen
		} else if col+1+wlen > wrapAt {
			sb.WriteString("\n")
			sb.WriteString(cont)
			sb.WriteString(w)
			col = wlen
		} else {
			sb.WriteString(" ")
			sb.WriteString(w)
			col += 1 + wlen
		}
	}
	return sb.String()
}

// CustomPoll represents a user-created poll loaded from polls/<name>.json.
type CustomPoll struct {
	Name        string   `json:"name"`
	Options     []string `json:"options"`
	Emojis      []string `json:"emojis,omitempty"`      // parallel to Options; falls back to number emojis if absent
	Preamble    string   `json:"preamble,omitempty"`    // optional text shown above the options
	Description string   `json:"description,omitempty"` // optional text shown below the options
	VotingMode  string   `json:"voting_mode,omitempty"` // "reaction" (default) or "button"
	Schedule        string `json:"schedule,omitempty"`         // e.g. "monday 09:00" — used by schedule_polls workflow
	ResultsSchedule string `json:"results_schedule,omitempty"` // e.g. "wednesday 17:00" — when to post results
	ChannelID       string `json:"channel_id,omitempty"`       // Slack channel to post to on schedule; falls back to SLACK_CHANNEL_ID env
	Slug        string   `json:"-"`                     // derived from filename, not stored in JSON
}

// LoadCustomPoll reads polls/<name>.json from disk.
func LoadCustomPoll(name string) (*CustomPoll, error) {
	data, err := os.ReadFile(filepath.Join(pollsDir, name+".json"))
	if err != nil {
		return nil, fmt.Errorf("poll %q not found: %w", name, err)
	}
	var p CustomPoll
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("invalid poll file for %q: %w", name, err)
	}
	p.Slug = name
	return &p, nil
}

// ToPollInstance returns the fallback text and emoji list for seeding reactions.
// For button-mode polls the emoji list is empty — no reactions are seeded.
func (p *CustomPoll) ToPollInstance() PollInstance {
	if p.VotingMode == "button" {
		text := fmt.Sprintf("@channel: 📊 *%s*\n\nClick a button to cast your vote.", p.Name)
		return PollInstance{Text: text}
	}
	text := fmt.Sprintf("@channel: 📊 *%s*\n\nReact to vote:", p.Name)
	emojis := make([]string, 0, len(p.Options))
	for i, opt := range p.Options {
		emoji := p.emojiAt(i)
		text += "\n" + optionLine(emoji, opt)
		emojis = append(emojis, emoji)
	}
	return PollInstance{Text: text, Emojis: emojis}
}

// ToBlocks returns Block Kit blocks for the custom poll.
func (p *CustomPoll) ToBlocks() []slack.Block {
	if p.VotingMode == "button" {
		return p.toButtonBlocks()
	}
	preamble := p.Preamble
	if preamble == "" {
		preamble = "React to vote!"
	}
	promptText := fmt.Sprintf("@channel: %s\n\nReact with one of the options below:", preamble)

	header := slack.NewSectionBlock(
		slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("*📊 %s*", p.Name), false, false),
		nil, nil,
	)
	prompt := slack.NewSectionBlock(
		slack.NewTextBlockObject("mrkdwn", promptText, false, false),
		nil, nil,
	)
	blocks := []slack.Block{header, prompt}
	for i, opt := range p.Options {
		blocks = append(blocks, slack.NewSectionBlock(
			slack.NewTextBlockObject("mrkdwn", optionLine(p.emojiAt(i), opt), false, false),
			nil, nil,
		))
	}
	if p.Description != "" {
		blocks = append(blocks, slack.NewSectionBlock(
			slack.NewTextBlockObject("mrkdwn", p.Description, false, false),
			nil, nil,
		))
	}
	marker := "poll_marker:custom"
	if p.Slug != "" {
		marker = "poll_marker:" + p.Slug
	}
	blocks = append(blocks, slack.NewContextBlock("poll_marker",
		slack.NewTextBlockObject("mrkdwn", marker, false, false),
	))
	return blocks
}

// toButtonBlocks returns Block Kit blocks for a button-voting poll.
// Each option is a section block with indented mrkdwn text and a primary button accessory
// showing the current vote count. The Worker updates the message in-place on each click.
func (p *CustomPoll) toButtonBlocks() []slack.Block {
	preamble := p.Preamble
	if preamble == "" {
		preamble = "Click a button to cast your vote:"
	} else {
		preamble = preamble + "\n\nClick a button to cast your vote:"
	}

	header := slack.NewSectionBlock(
		slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("*📊 %s*", p.Name), false, false),
		nil, nil,
	)
	prompt := slack.NewSectionBlock(
		slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("@channel: %s", preamble), false, false),
		nil, nil,
	)
	blocks := []slack.Block{header, prompt}

	for i, opt := range p.Options {
		btn := slack.NewButtonBlockElement(
			"poll_vote",
			fmt.Sprintf("%s:%d", p.Slug, i),
			slack.NewTextBlockObject("plain_text", "0 votes", false, false),
		)
		btn.Style = "primary"
		blocks = append(blocks, slack.NewSectionBlock(
			slack.NewTextBlockObject("mrkdwn", optionLine(p.emojiAt(i), opt), false, false),
			nil,
			slack.NewAccessory(btn),
		))
	}

	if p.Description != "" {
		blocks = append(blocks, slack.NewSectionBlock(
			slack.NewTextBlockObject("mrkdwn", p.Description, false, false),
			nil, nil,
		))
	}

	marker := "poll_marker:custom"
	if p.Slug != "" {
		marker = "poll_marker:" + p.Slug
	}
	blocks = append(blocks, slack.NewContextBlock("poll_marker",
		slack.NewTextBlockObject("mrkdwn", marker, false, false),
	))
	return blocks
}

// emojiAt returns the explicit emoji for index i, or a number emoji if none was set.
func (p *CustomPoll) emojiAt(i int) string {
	if i < len(p.Emojis) && p.Emojis[i] != "" {
		return p.Emojis[i]
	}
	return numberEmoji(i)
}

// LabelMap returns a map of emoji name → option label for use in tallying and notifications.
func (p *CustomPoll) LabelMap() map[string]string {
	m := make(map[string]string, len(p.Options))
	for i, opt := range p.Options {
		m[p.emojiAt(i)] = opt
	}
	return m
}

func numberEmoji(i int) string {
	if i < len(numberEmojis) {
		return numberEmojis[i]
	}
	return "question"
}
