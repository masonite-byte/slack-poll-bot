package slackclient

import (
    "fmt"
    "os"

    "github.com/slack-go/slack"
)

type Client struct {
    api       *slack.Client
    channelID string
}

// New initializes the Slack client using environment variables
func New() *Client {
    return &Client{
        api:       slack.New(os.Getenv("SLACK_BOT_TOKEN")),
        channelID: os.Getenv("SLACK_CHANNEL_ID"),
    }
}

// PostMessage sends a raw text message to the configured channel
func (c *Client) PostMessage(text string) (string, string, error) {
    return c.api.PostMessage(
        c.channelID,
        slack.MsgOptionText(text, false),
    )
}

// AddReaction attaches a clickable emoji directly to a posted message
func (c *Client) AddReaction(name, timestamp string) error {
    ref := slack.NewRefToMessage(c.channelID, timestamp)
    return c.api.AddReaction(name, ref)
}

// GetReactions retrieves all emoji counts attached to a given message timestamp
func (c *Client) GetReactions(timestamp string) ([]slack.ItemReaction, error) {
    ref := slack.NewRefToMessage(c.channelID, timestamp)
    return c.api.GetReactions(ref, slack.NewGetReactionsParameters())
}

// FindLatestPoll scans the recent history of the channel to find the last posted poll timestamp
func (c *Client) FindLatestPoll() (string, error) {
    params := &slack.GetConversationHistoryParameters{
        ChannelID: c.channelID,
        Limit:     20, // Scans the last 20 messages in the channel
    }

    history, err := c.api.GetConversationHistory(params)
    if err != nil {
        return "", err
    }

    for _, msg := range history.Messages {
        if containsPollHeader(msg.Text) {
            return msg.Timestamp, nil
        }
    }
    return "", fmt.Errorf("no recent poll found in the last 20 messages")
}

// Helper function to verify if the message text matches our specific poll signature
func containsPollHeader(text string) bool {
    return len(text) >= 17 && text[:17] == "📊 *Weekly Poll*"
}
