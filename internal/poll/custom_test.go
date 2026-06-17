package poll

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/slack-go/slack"
)

func withTempPollsDir(t *testing.T, files map[string]string) {
	t.Helper()
	dir := t.TempDir()
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
			t.Fatalf("failed to write test poll file: %v", err)
		}
	}
	orig := pollsDir
	pollsDir = dir
	t.Cleanup(func() { pollsDir = orig })
}

func TestLoadCustomPollFileNotFound(t *testing.T) {
	withTempPollsDir(t, nil)
	_, err := LoadCustomPoll("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent poll, got nil")
	}
}

func TestLoadCustomPollInvalidJSON(t *testing.T) {
	withTempPollsDir(t, map[string]string{"bad.json": `{not valid json`})
	_, err := LoadCustomPoll("bad")
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

func TestLoadCustomPollSetsSlug(t *testing.T) {
	withTempPollsDir(t, map[string]string{
		"summer-sports.json": `{"name":"Summer Sports","options":["Frisbee","Volleyball"]}`,
	})
	p, err := LoadCustomPoll("summer-sports")
	if err != nil {
		t.Fatalf("LoadCustomPoll error: %v", err)
	}
	if p.Slug != "summer-sports" {
		t.Fatalf("expected slug summer-sports, got %q", p.Slug)
	}
	if p.Name != "Summer Sports" {
		t.Fatalf("expected name Summer Sports, got %q", p.Name)
	}
	if len(p.Options) != 2 {
		t.Fatalf("expected 2 options, got %d", len(p.Options))
	}
}

func TestCustomPollToPollInstanceAssignsNumberEmojis(t *testing.T) {
	p := &CustomPoll{Name: "Test Poll", Options: []string{"Alpha", "Beta", "Gamma"}, Slug: "test-poll"}
	instance := p.ToPollInstance()

	if len(instance.Emojis) != 3 {
		t.Fatalf("expected 3 emojis, got %d", len(instance.Emojis))
	}
	if instance.Emojis[0] != "one" || instance.Emojis[1] != "two" || instance.Emojis[2] != "three" {
		t.Fatalf("expected [one two three], got %v", instance.Emojis)
	}
}

func TestCustomPollToPollInstanceTextContainsOptions(t *testing.T) {
	p := &CustomPoll{Name: "Test Poll", Options: []string{"Alpha", "Beta"}, Slug: "test-poll"}
	instance := p.ToPollInstance()

	if !strings.Contains(instance.Text, ":one: Alpha") {
		t.Fatalf("expected :one: Alpha in text, got %q", instance.Text)
	}
	if !strings.Contains(instance.Text, ":two: Beta") {
		t.Fatalf("expected :two: Beta in text, got %q", instance.Text)
	}
	if !strings.Contains(instance.Text, "Test Poll") {
		t.Fatalf("expected poll name in text, got %q", instance.Text)
	}
}

func TestCustomPollToBlocksMarkerUsesSlug(t *testing.T) {
	p := &CustomPoll{Name: "Summer Sports", Options: []string{"Frisbee", "Volleyball"}, Slug: "summer-sports"}
	blocks := p.ToBlocks()

	marker, ok := blocks[len(blocks)-1].(*slack.ContextBlock)
	if !ok {
		t.Fatalf("expected last block to be *slack.ContextBlock, got %T", blocks[len(blocks)-1])
	}
	text, ok := marker.ContextElements.Elements[0].(*slack.TextBlockObject)
	if !ok {
		t.Fatalf("expected context element to be *slack.TextBlockObject")
	}
	if text.Text != "poll_marker:summer-sports" {
		t.Fatalf("expected poll_marker:summer-sports, got %q", text.Text)
	}
}

func TestCustomPollToBlocksNoSlugFallsBackToCustom(t *testing.T) {
	p := &CustomPoll{Name: "Test", Options: []string{"A", "B"}}
	blocks := p.ToBlocks()

	marker, ok := blocks[len(blocks)-1].(*slack.ContextBlock)
	if !ok {
		t.Fatalf("expected last block to be *slack.ContextBlock")
	}
	text, ok := marker.ContextElements.Elements[0].(*slack.TextBlockObject)
	if !ok {
		t.Fatalf("expected context element to be *slack.TextBlockObject")
	}
	if text.Text != "poll_marker:custom" {
		t.Fatalf("expected poll_marker:custom fallback, got %q", text.Text)
	}
}

func TestCustomPollToBlocksOptionCount(t *testing.T) {
	p := &CustomPoll{Name: "Test", Options: []string{"A", "B", "C"}, Slug: "test"}
	blocks := p.ToBlocks()
	// header + prompt + 3 options + marker = 6
	if len(blocks) != 6 {
		t.Fatalf("expected 6 blocks, got %d", len(blocks))
	}
}

func TestNumberEmojiReturnsCorrectStrings(t *testing.T) {
	cases := []struct {
		index int
		want  string
	}{
		{0, "one"},
		{1, "two"},
		{4, "five"},
		{8, "nine"},
	}
	for _, c := range cases {
		got := numberEmoji(c.index)
		if got != c.want {
			t.Errorf("numberEmoji(%d) = %q, want %q", c.index, got, c.want)
		}
	}
}

func TestNumberEmojiOutOfRangeFallsBack(t *testing.T) {
	if got := numberEmoji(9); got != "question" {
		t.Fatalf("expected question for out-of-range index, got %q", got)
	}
}

func TestCustomPollEmojiAtUsesExplicitEmoji(t *testing.T) {
	p := &CustomPoll{Options: []string{"Soccer", "Basketball"}, Emojis: []string{"soccer", "basketball"}}
	if got := p.emojiAt(0); got != "soccer" {
		t.Fatalf("expected soccer, got %q", got)
	}
	if got := p.emojiAt(1); got != "basketball" {
		t.Fatalf("expected basketball, got %q", got)
	}
}

func TestCustomPollEmojiAtFallsBackToNumberWhenNoEmoji(t *testing.T) {
	p := &CustomPoll{Options: []string{"A", "B"}} // no Emojis set
	if got := p.emojiAt(0); got != "one" {
		t.Fatalf("expected one, got %q", got)
	}
	if got := p.emojiAt(1); got != "two" {
		t.Fatalf("expected two, got %q", got)
	}
}

func TestCustomPollLabelMapExplicitEmojis(t *testing.T) {
	p := &CustomPoll{
		Options: []string{"Soccer", "Basketball", "Frisbee"},
		Emojis:  []string{"soccer", "basketball", "flying_disc"},
	}
	m := p.LabelMap()
	if m["soccer"] != "Soccer" {
		t.Fatalf("expected soccer→Soccer, got %q", m["soccer"])
	}
	if m["basketball"] != "Basketball" {
		t.Fatalf("expected basketball→Basketball, got %q", m["basketball"])
	}
	if m["flying_disc"] != "Frisbee" {
		t.Fatalf("expected flying_disc→Frisbee, got %q", m["flying_disc"])
	}
}

func TestCustomPollLabelMapNumberEmojisFallback(t *testing.T) {
	p := &CustomPoll{Options: []string{"Alpha", "Beta", "Gamma"}}
	m := p.LabelMap()
	if m["one"] != "Alpha" {
		t.Fatalf("expected one→Alpha, got %q", m["one"])
	}
	if m["two"] != "Beta" {
		t.Fatalf("expected two→Beta, got %q", m["two"])
	}
	if m["three"] != "Gamma" {
		t.Fatalf("expected three→Gamma, got %q", m["three"])
	}
}
