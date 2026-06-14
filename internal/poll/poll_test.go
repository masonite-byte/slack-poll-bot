package poll

import (
	"strings"
	"testing"

	"github.com/slack-go/slack"
)

func TestWeeklyPollContainsHeaderAndOptions(t *testing.T) {
	s := weeklyPoll()
	if !strings.HasPrefix(s, "📊 *Weekly Poll*") {
		t.Fatalf("WeeklyPoll() missing header; got: %q", s)
	}
	if !strings.Contains(s, "Option A") || !strings.Contains(s, "Option B") || !strings.Contains(s, "Option C") {
		t.Fatalf("WeeklyPoll() missing expected options; got: %q", s)
	}
}

func TestBuildPollBlocksIncludesMarkerAndOptions(t *testing.T) {
	blocks := BuildPollBlocks("Test Poll", "Vote now:", "testmarker", []string{"Option A", "Option B"})
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
	blocks := RunoffPollBlocks(options)
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

func TestPollOptionsTextIncludesAllDefaultOptions(t *testing.T) {
	got := PollOptionsText()
	if !strings.Contains(got, ":+1: Option A") || !strings.Contains(got, ":tada: Option B") || !strings.Contains(got, ":rocket: Option C") {
		t.Fatalf("PollOptionsText() output missing expected options; got: %q", got)
	}
}
