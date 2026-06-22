package testutil

import (
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
	"github.com/slack-go/slack"
)

type MockAPI struct {
	Posted               string
	Ts                   string
	PollSlug             string
	Reactions            []slackclient.Reaction
	BotID                string
	Added                []string
	Deleted              []string
	PreviousWinner       string
	PreviousWinnerBySlug map[string]string
	FindLatestPollErr    error
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
func (m *MockAPI) FindLatestPoll() (string, string, error) {
	return m.Ts, m.PollSlug, m.FindLatestPollErr
}
func (m *MockAPI) FindPollBySlug(slug string) (string, error) { return m.Ts, m.FindLatestPollErr }
func (m *MockAPI) FindPreviousWinner(slug string) (string, error) {
	if m.PreviousWinnerBySlug != nil {
		return m.PreviousWinnerBySlug[slug], nil
	}
	return m.PreviousWinner, nil
}
func (m *MockAPI) BotUserID() (string, error) { return m.BotID, nil }
func (m *MockAPI) ChannelID() string          { return "C" }
func (m *MockAPI) DeleteMessage(channelID, timestamp string) error {
	m.Deleted = append(m.Deleted, timestamp)
	return nil
}
func (m *MockAPI) SendDM(userID, text string) error { return nil }
