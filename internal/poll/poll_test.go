package poll

import (
	"strings"
	"testing"

	"github.com/slack-go/slack"
)

func TestBuildPollBlocksIncludesMarkerAndOptions(t *testing.T) {
	blocks := BuildPollBlocks("Test Poll", "Vote now:", "testmarker", []string{"Option A", "Option B"}, nil)
	if len(blocks) != 5 {
		t.Fatalf("expected 5 blocks, got %d", len(blocks))
	}

	marker, ok := blocks[4].(*slack.ContextBlock)
	if !ok {
		t.Fatalf("expected last block to be *slack.ContextBlock, got %T", blocks[4])
	}
	if marker.BlockID != "poll_marker" {
		t.Fatalf("expected marker BlockID poll_marker, got %q", marker.BlockID)
	}

	text, ok := marker.ContextElements.Elements[0].(*slack.TextBlockObject)
	if !ok {
		t.Fatalf("expected marker element to be *slack.TextBlockObject, got %T", marker.ContextElements.Elements[0])
	}
	if !strings.Contains(text.Text, "poll_marker:testmarker") {
		t.Fatalf("expected marker text to contain poll_marker:testmarker, got %q", text.Text)
	}
}

func TestRunoffPollBlocksPreservesTieOptions(t *testing.T) {
	options := []string{"Option A", "Option B"}
	blocks := RunoffPollBlocks(options, nil)
	if len(blocks) != 5 {
		t.Fatalf("expected 5 blocks, got %d", len(blocks))
	}

	optionA, ok := blocks[2].(*slack.SectionBlock)
	if !ok {
		t.Fatalf("expected option block to be *slack.SectionBlock, got %T", blocks[2])
	}
	if !strings.Contains(optionA.Text.Text, "Option A") {
		t.Fatalf("expected Option A text in runoff blocks, got %q", optionA.Text.Text)
	}
}

func TestGetRunoffPollUsesSportsEmojiMapWhenAvailable(t *testing.T) {
	instance := GetRunoffPoll([]string{"Soccer", "Basketball"}, nil)
	if !strings.Contains(instance.Text, ":soccer: Soccer") || !strings.Contains(instance.Text, ":basketball: Basketball") {
		t.Fatalf("expected sports emoji shortcodes in runoff text, got %q", instance.Text)
	}
}

func TestGetRunoffPollUsesProvidedEmojiMap(t *testing.T) {
	emojiMap := map[string]string{"Swimming": "swimmer", "Cycling": "bicyclist"}
	instance := GetRunoffPoll([]string{"Swimming", "Cycling"}, emojiMap)
	if !strings.Contains(instance.Text, ":swimmer: Swimming") || !strings.Contains(instance.Text, ":bicyclist: Cycling") {
		t.Fatalf("expected custom emoji map to be used, got %q", instance.Text)
	}
}

func TestGetRunoffPollFallsBackToSlugifiedEmojiName(t *testing.T) {
	instance := GetRunoffPoll([]string{"Team Relay"}, nil)
	if len(instance.Emojis) != 1 || instance.Emojis[0] != "team_relay" {
		t.Fatalf("expected slugified fallback emoji name, got %v", instance.Emojis)
	}
}
