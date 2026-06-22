package slackclient

import (
	"testing"

	"github.com/slack-go/slack"
)

func TestContainsPollMarker(t *testing.T) {
	markerBlock := slack.NewContextBlock("poll_marker",
		slack.NewTextBlockObject("mrkdwn", "poll_marker:weekly", false, false),
	)

	msg := slack.Message{Msg: slack.Msg{Blocks: slack.Blocks{BlockSet: []slack.Block{markerBlock}}}}

	if !containsPollMarker(msg) {
		t.Fatalf("expected poll marker to be detected")
	}
}

func TestPollMarkerSlugExtractsSlug(t *testing.T) {
	cases := []struct {
		marker string
		want   string
	}{
		{"poll_marker:weekly", "weekly"},
		{"poll_marker:runoff", "runoff"},
		{"poll_marker:summer-sports", "summer-sports"},
	}
	for _, c := range cases {
		block := slack.NewContextBlock("poll_marker",
			slack.NewTextBlockObject("mrkdwn", c.marker, false, false),
		)
		msg := slack.Message{Msg: slack.Msg{Blocks: slack.Blocks{BlockSet: []slack.Block{block}}}}
		got := pollMarkerSlug(msg)
		if got != c.want {
			t.Errorf("pollMarkerSlug with %q = %q, want %q", c.marker, got, c.want)
		}
	}
}

func TestResultsMarkerSlugExtractsSlug(t *testing.T) {
	block := slack.NewContextBlock("results_marker",
		slack.NewTextBlockObject("mrkdwn", "results_marker:weekly", false, false),
	)
	msg := slack.Message{Msg: slack.Msg{Blocks: slack.Blocks{BlockSet: []slack.Block{block}}}}
	if got := resultsMarkerSlug(msg); got != "weekly" {
		t.Fatalf("expected weekly results slug, got %q", got)
	}
}

func TestPollMarkerSlugReturnsEmptyForNoMarker(t *testing.T) {
	msg := slack.Message{}
	if got := pollMarkerSlug(msg); got != "" {
		t.Fatalf("expected empty slug for message with no blocks, got %q", got)
	}
}

func TestContainsPollMarkerIgnoresNonPollMarkerBlock(t *testing.T) {
	markerBlock := slack.NewContextBlock("other_context",
		slack.NewTextBlockObject("mrkdwn", "poll_marker:weekly", false, false),
	)

	msg := slack.Message{Msg: slack.Msg{Blocks: slack.Blocks{BlockSet: []slack.Block{markerBlock}}}}
	if containsPollMarker(msg) {
		t.Fatalf("expected non-poll marker block to be ignored")
	}
}

func TestParseTopEvent(t *testing.T) {
	got := parseTopEvent("📊 *Final Poll Results Are In!*\nTop event: Soccer.")
	if got != "Soccer" {
		t.Fatalf("expected Soccer, got %q", got)
	}
}
