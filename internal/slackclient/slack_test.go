package slackclient

import (
	"testing"

	"github.com/slack-go/slack"
)

func TestContainsPollHeader(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"📊 *Weekly Poll*\nWhat should we do?", true},
		{"Random message", false},
		{"📊 *Weekly Poll* - extra", true},
		{"📊 Weekly Poll", false},
	}

	for _, c := range cases {
		got := containsPollHeader(c.in)
		if got != c.want {
			t.Fatalf("containsPollHeader(%q) = %v; want %v", c.in, got, c.want)
		}
	}
}

func TestContainsPollMarker(t *testing.T) {
	markerBlock := slack.NewContextBlock("poll_marker",
		slack.NewTextBlockObject("mrkdwn", "poll_marker:weekly", false, false),
	)

	msg := slack.Message{}
	msg.Blocks = slack.Blocks{BlockSet: []slack.Block{markerBlock}}

	if !containsPollMarker(msg) {
		t.Fatalf("expected poll marker to be detected")
	}
}
