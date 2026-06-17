package runner

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/masonite-byte/slack-poll-bot/internal/poll"
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

	result := BuildResults(tallyResults(reactions, "B0", nil))
	if !strings.Contains(result, "Top event: Soccer.") {
		t.Fatalf("expected top event summary for Soccer, got %q", result)
	}
}

func TestBuildResultsReportsTie(t *testing.T) {
	reactions := []slackclient.Reaction{
		{Name: "soccer", Count: 1, Users: []string{"U1"}},
		{Name: "basketball", Count: 1, Users: []string{"U2"}},
	}

	result := BuildResults(tallyResults(reactions, "B0", nil))
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
	result := BuildResults(tallyResults(reactions, "B0", nil))
	if !strings.Contains(result, "No votes have been cast yet.") {
		t.Fatalf("expected bot-only reaction to be ignored, got %q", result)
	}
}

func TestBuildResultsUnknownEmojiLabelFallsBack(t *testing.T) {
	reactions := []slackclient.Reaction{{Name: "heart", Count: 2, Users: []string{"U1", "U2"}}}
	result := BuildResults(tallyResults(reactions, "B0", nil))
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

func TestRunResultsNoPollFoundReturnsErrAndPostsMessage(t *testing.T) {
	m := &testutil.MockAPI{
		FindLatestPollErr: fmt.Errorf("no recent poll found in the last 5 pages"),
	}
	_, _, err := RunResults(m)
	if !errors.Is(err, ErrNoPollFound) {
		t.Fatalf("expected ErrNoPollFound, got %v", err)
	}
	if !strings.Contains(m.Posted, "No active poll found") {
		t.Fatalf("expected 'No active poll found' message posted to channel, got %q", m.Posted)
	}
}

func TestRunResultsOtherErrorPropagates(t *testing.T) {
	m := &testutil.MockAPI{
		FindLatestPollErr: fmt.Errorf("network timeout"),
	}
	_, _, err := RunResults(m)
	if errors.Is(err, ErrNoPollFound) {
		t.Fatal("expected non-ErrNoPollFound error to propagate, got ErrNoPollFound")
	}
	if err == nil {
		t.Fatal("expected error to propagate, got nil")
	}
}

func TestRunPostCustomPollSeedsReactions(t *testing.T) {
	m := &testutil.MockAPI{Ts: "123"}
	p := &poll.CustomPoll{Name: "Test Poll", Options: []string{"Alpha", "Beta", "Gamma"}, Slug: "test-poll"}
	if err := RunPostCustomPoll(m, p); err != nil {
		t.Fatalf("RunPostCustomPoll error: %v", err)
	}
	if m.Posted == "" {
		t.Fatal("expected poll message to be posted")
	}
	if len(m.Added) != 3 {
		t.Fatalf("expected 3 seeded reactions, got %d", len(m.Added))
	}
	if m.Added[0] != "one" || m.Added[1] != "two" || m.Added[2] != "three" {
		t.Fatalf("expected reactions [one two three], got %v", m.Added)
	}
}

func TestRunPostCustomPollButtonModeNoReactionsSeeded(t *testing.T) {
	m := &testutil.MockAPI{Ts: "456"}
	p := &poll.CustomPoll{Name: "Button Poll", Options: []string{"A", "B"}, Slug: "button-poll", VotingMode: "button"}
	if err := RunPostCustomPoll(m, p); err != nil {
		t.Fatalf("RunPostCustomPoll error: %v", err)
	}
	if m.Posted == "" {
		t.Fatal("expected poll message to be posted")
	}
	if len(m.Added) != 0 {
		t.Fatalf("button mode: expected no seeded reactions, got %v", m.Added)
	}
}
