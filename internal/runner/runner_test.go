package runner

import (
	"strings"
	"testing"

	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
	"github.com/masonite-byte/slack-poll-bot/internal/testutil"
)

func TestRunPostPollSeedsReactions(t *testing.T) {
	m := &testutil.MockAPI{Ts: "123"}
	if err := RunPostPoll(m); err != nil {
		t.Fatalf("RunPostPoll error: %v", err)
	}
	if m.Posted == "" {
		t.Fatalf("expected post to be sent")
	}
	if len(m.Added) != 6 {
		t.Fatalf("expected 6 seeded reactions, got %d", len(m.Added))
	}
}

func TestRunResultsComputesCounts(t *testing.T) {
	m := &testutil.MockAPI{Ts: "321", BotID: "B0", Reactions: []slackclient.Reaction{
		{Name: "thumbsup", Count: 2, Users: []string{"B0", "U1"}},
		{Name: "tada", Count: 1, Users: []string{"U2"}},
	}}

	out, isTie, err := RunResults(m)
	if err != nil {
		t.Fatalf("RunResults error: %v", err)
	}
	if out == "" {
		t.Fatalf("expected final message content")
	}
	if len(m.Posted) == 0 {
		t.Fatalf("expected summary to be posted")
	}
	if !isTie {
		t.Fatalf("expected tie to be detected (thumbsup=1 vs tada=1 after deducting bot)")
	}
}

func TestBuildResultsReportsTopEvent(t *testing.T) {
	reactions := []slackclient.Reaction{
		{Name: "soccer", Count: 3, Users: []string{"U1", "B0"}},
		{Name: "basketball", Count: 1, Users: []string{"U2"}},
	}

	result := BuildResults(tallyResults(reactions, "B0"))
	if !strings.Contains(result, "Top event: Soccer.") {
		t.Fatalf("expected top event summary for Soccer, got %q", result)
	}
}

func TestBuildResultsReportsTie(t *testing.T) {
	reactions := []slackclient.Reaction{
		{Name: "soccer", Count: 1, Users: []string{"U1"}},
		{Name: "basketball", Count: 1, Users: []string{"U2"}},
	}

	result := BuildResults(tallyResults(reactions, "B0"))
	if !strings.Contains(result, "It's a tie between Basketball and Soccer.") {
		t.Fatalf("expected tie summary for Basketball and Soccer, got %q", result)
	}
}

func TestBuildResultsNoVotes(t *testing.T) {
	result := BuildResults(nil)
	if !strings.Contains(result, "No votes have been cast yet.") {
		t.Fatalf("expected no votes summary, got %q", result)
	}
}

func TestBuildResultsIgnoresBotOnlyReaction(t *testing.T) {
	reactions := []slackclient.Reaction{{Name: "+1", Count: 1, Users: []string{"B0"}}}
	result := BuildResults(tallyResults(reactions, "B0"))
	if !strings.Contains(result, "No votes have been cast yet.") {
		t.Fatalf("expected bot-only reaction to be ignored, got %q", result)
	}
}

func TestBuildResultsUnknownEmojiLabelFallsBack(t *testing.T) {
	reactions := []slackclient.Reaction{{Name: "heart", Count: 2, Users: []string{"U1", "U2"}}}
	result := BuildResults(tallyResults(reactions, "B0"))
	if !strings.Contains(result, "heart received 2 votes") {
		t.Fatalf("expected fallback label for unknown reaction, got %q", result)
	}
}

func TestRunoffPollNoVotes(t *testing.T) {
	m := &testutil.MockAPI{Ts: "321", BotID: "B0", Reactions: []slackclient.Reaction{}}
	result, err := RunoffPoll(m)
	if err != nil {
		t.Fatalf("RunoffPoll error: %v", err)
	}
	if !strings.Contains(result, "No votes have been cast yet. Runoff requires at least one vote.") {
		t.Fatalf("unexpected runoff result for no votes: %q", result)
	}
}

func TestRunoffPollNoRunoffWhenLeader(t *testing.T) {
	m := &testutil.MockAPI{Ts: "321", BotID: "B0", Reactions: []slackclient.Reaction{
		{Name: "soccer", Count: 3, Users: []string{"U1"}},
		{Name: "basketball", Count: 1, Users: []string{"U2"}},
	}}
	result, err := RunoffPoll(m)
	if err != nil {
		t.Fatalf("RunoffPoll error: %v", err)
	}
	if !strings.Contains(result, "No runoff required. Current leader is Soccer.") {
		t.Fatalf("unexpected runoff result when leader exists: %q", result)
	}
	if m.Posted != "" {
		t.Fatalf("expected no new poll posted when no runoff is needed, got %q", m.Posted)
	}
}
