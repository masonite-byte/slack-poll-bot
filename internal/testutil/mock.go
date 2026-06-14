package testutil

import (
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
	"github.com/slack-go/slack"
)

type MockAPI struct {
	Posted    string
	Ts        string
	Reactions []slackclient.Reaction
	BotID     string
	Added     []string
}

func (m *MockAPI) PostMessage(text string) (string, string, error) {
	m.Posted = text
	return "C", m.Ts, nil
}
func (m *MockAPI) PostBlocks(text string, blocks ...slack.Block) (string, string, error) {
	m.Posted = text
	return "C", m.Ts, nil
}
func (m *MockAPI) AddReaction(name, timestamp string) error {
	m.Added = append(m.Added, name)
	return nil
}
func (m *MockAPI) GetReactions(timestamp string) ([]slackclient.Reaction, error) {
	return m.Reactions, nil
}
func (m *MockAPI) FindLatestPoll() (string, error)                 { return m.Ts, nil }
func (m *MockAPI) BotUserID() (string, error)                      { return m.BotID, nil }
func (m *MockAPI) ChannelID() string                               { return "C" }
func (m *MockAPI) DeleteMessage(channelID, timestamp string) error { return nil }
