package runner

import (
	"strings"
	"testing"

	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
	"github.com/slack-go/slack"
)

type mockAPI struct {
	posted    string
	ts        string
	reactions []slackclient.Reaction
	botID     string
	added     []string
}

func (m *mockAPI) PostMessage(text string) (string, string, error) {
	m.posted = text
	return "C", m.ts, nil
}
func (m *mockAPI) PostBlocks(text string, blocks ...slack.Block) (string, string, error) {
	m.posted = text
	return "C", m.ts, nil
}
func (m *mockAPI) AddReaction(name, timestamp string) error {
	m.added = append(m.added, name)
	return nil
}
func (m *mockAPI) GetReactions(timestamp string) ([]slackclient.Reaction, error) {
	return m.reactions, nil
}
func (m *mockAPI) FindLatestPoll() (string, error)              { return m.ts, nil }
func (m *mockAPI) BotUserID() (string, error)                   { return m.botID, nil }
func (m *mockAPI) ChannelID() string                            { return "C" }
func (m *mockAPI) DeleteMessage(channelID, timestamp string) error { return nil }

func TestRunPostPollSeedsReactions(t *testing.T) {
	m := &mockAPI{ts: "123"}
	if err := RunPostPoll(m); err != nil {
		t.Fatalf("RunPostPoll error: %v", err)
	}
	if m.posted == "" {
		t.Fatalf("expected post to be sent")
	}
	if len(m.added) != 3 {
		t.Fatalf("expected 3 seeded reactions, got %d", len(m.added))
	}
}

func TestRunResultsComputesCounts(t *testing.T) {
	m := &mockAPI{ts: "321", botID: "B0", reactions: []slackclient.Reaction{
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
	if len(m.posted) == 0 {
		t.Fatalf("expected summary to be posted")
	}
	if !isTie {
		t.Fatalf("expected tie to be detected (thumbsup=1 vs tada=1 after deducting bot)")
	}
}

func TestBuildResultsReportsTopEvent(t *testing.T) {
	reactions := []slackclient.Reaction{
		{Name: "+1", Count: 3, Users: []string{"U1", "B0"}},
		{Name: "tada", Count: 1, Users: []string{"U2"}},
	}

	result := BuildResults(reactions, "B0")
	if !strings.Contains(result, "Top event: Option A.") {
		t.Fatalf("expected top event summary for Option A, got %q", result)
	}
}

func TestBuildResultsReportsTie(t *testing.T) {
	reactions := []slackclient.Reaction{
		{Name: "+1", Count: 1, Users: []string{"U1"}},
		{Name: "tada", Count: 1, Users: []string{"U2"}},
	}

	result := BuildResults(reactions, "B0")
	if !strings.Contains(result, "It's a tie between Option A and Option B.") {
		t.Fatalf("expected tie summary for Option A and Option B, got %q", result)
	}
}

func TestBuildResultsNoVotes(t *testing.T) {
	result := BuildResults(nil, "B0")
	if !strings.Contains(result, "No votes have been cast yet.") {
		t.Fatalf("expected no votes summary, got %q", result)
	}
}

func TestBuildResultsIgnoresBotOnlyReaction(t *testing.T) {
	reactions := []slackclient.Reaction{{Name: "+1", Count: 1, Users: []string{"B0"}}}
	result := BuildResults(reactions, "B0")
	if !strings.Contains(result, "No votes have been cast yet.") {
		t.Fatalf("expected bot-only reaction to be ignored, got %q", result)
	}
}

func TestBuildResultsUnknownEmojiLabelFallsBack(t *testing.T) {
	reactions := []slackclient.Reaction{{Name: "heart", Count: 2, Users: []string{"U1", "U2"}}}
	result := BuildResults(reactions, "B0")
	if !strings.Contains(result, "heart received 2 votes") {
		t.Fatalf("expected fallback label for unknown reaction, got %q", result)
	}
}

func TestRunoffPollNoVotes(t *testing.T) {
	m := &mockAPI{ts: "321", botID: "B0", reactions: []slackclient.Reaction{}}
	result, err := RunoffPoll(m)
	if err != nil {
		t.Fatalf("RunoffPoll error: %v", err)
	}
	if !strings.Contains(result, "No votes have been cast yet. Runoff requires at least one vote.") {
		t.Fatalf("unexpected runoff result for no votes: %q", result)
	}
}

func TestRunoffPollNoRunoffWhenLeader(t *testing.T) {
	m := &mockAPI{ts: "321", botID: "B0", reactions: []slackclient.Reaction{
		{Name: "+1", Count: 3, Users: []string{"U1"}},
		{Name: "tada", Count: 1, Users: []string{"U2"}},
	}}
	result, err := RunoffPoll(m)
	if err != nil {
		t.Fatalf("RunoffPoll error: %v", err)
	}
	if !strings.Contains(result, "No runoff required. Current leader is Option A.") {
		t.Fatalf("unexpected runoff result when leader exists: %q", result)
	}
	if m.posted != "" {
		t.Fatalf("expected no new poll posted when no runoff is needed, got %q", m.posted)
	}
}
