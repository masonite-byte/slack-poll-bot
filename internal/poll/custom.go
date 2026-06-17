package poll

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/slack-go/slack"
)

// pollsDir is the directory where custom poll JSON files are stored.
// Overridable in tests.
var pollsDir = "polls"

var numberEmojis = []string{"one", "two", "three", "four", "five", "six", "seven", "eight", "nine"}

// CustomPoll represents a user-created poll loaded from polls/<name>.json.
type CustomPoll struct {
	Name    string   `json:"name"`
	Options []string `json:"options"`
	Emojis  []string `json:"emojis,omitempty"` // parallel to Options; falls back to number emojis if absent
	Slug    string   `json:"-"`                 // derived from filename, not stored in JSON
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
func (p *CustomPoll) ToPollInstance() PollInstance {
	text := fmt.Sprintf("@channel: 📊 *%s*\n\nReact to vote:", p.Name)
	emojis := make([]string, 0, len(p.Options))
	for i, opt := range p.Options {
		emoji := p.emojiAt(i)
		text += fmt.Sprintf("\n    :%s: %s", emoji, opt)
		emojis = append(emojis, emoji)
	}
	return PollInstance{Text: text, Emojis: emojis}
}

// ToBlocks returns Block Kit blocks for the custom poll.
func (p *CustomPoll) ToBlocks() []slack.Block {
	header := slack.NewSectionBlock(
		slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("*📊 %s*", p.Name), false, false),
		nil, nil,
	)
	prompt := slack.NewSectionBlock(
		slack.NewTextBlockObject("mrkdwn", "@channel: React to vote!\n\nReact with one of the options below:", false, false),
		nil, nil,
	)
	blocks := []slack.Block{header, prompt}
	for i, opt := range p.Options {
		blocks = append(blocks, slack.NewSectionBlock(
			slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("    :%s: %s", p.emojiAt(i), opt), false, false),
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
