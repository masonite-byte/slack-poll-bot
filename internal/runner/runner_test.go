package runner

import (
	"testing"

	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
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
func (m *mockAPI) AddReaction(name, timestamp string) error {
	m.added = append(m.added, name)
	return nil
}
func (m *mockAPI) GetReactions(timestamp string) ([]slackclient.Reaction, error) {
	return m.reactions, nil
}
func (m *mockAPI) FindLatestPoll() (string, error) { return m.ts, nil }
func (m *mockAPI) BotUserID() (string, error)      { return m.botID, nil }

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

	out, err := RunResults(m)
	if err != nil {
		t.Fatalf("RunResults error: %v", err)
	}
	if out == "" {
		t.Fatalf("expected final message content")
	}
	if len(m.posted) == 0 {
		t.Fatalf("expected summary to be posted")
	}
}
