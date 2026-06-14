package slackclient

import (
    "fmt"
    "log"
    "os"
    "strings"

    "github.com/slack-go/slack"
)

type Client struct {
    api       *slack.Client
    channelID string
    botUserID string
}

// New initializes the Slack client using environment variables and validates them
func New() *Client {
    token := os.Getenv("SLACK_BOT_TOKEN")
    channel := os.Getenv("SLACK_CHANNEL_ID")
    if token == "" || channel == "" {
        log.Fatalf("missing required env vars: SLACK_BOT_TOKEN and SLACK_CHANNEL_ID must be set")
    }

    return &Client{
        api:       slack.New(token),
        channelID: channel,
    }
}

// PostMessage sends a raw text message to the configured channel
func (c *Client) PostMessage(text string) (string, string, error) {
    return c.api.PostMessage(
        c.channelID,
        slack.MsgOptionText(text, false),
    )
}

// AddReaction attaches an emoji reaction to a posted message
func (c *Client) AddReaction(name, timestamp string) error {
    ref := slack.NewRefToMessage(c.channelID, timestamp)
    return c.api.AddReaction(name, ref)
}

// GetReactions retrieves all emoji counts attached to a given message timestamp
func (c *Client) GetReactions(timestamp string) ([]slack.ItemReaction, error) {
    ref := slack.NewRefToMessage(c.channelID, timestamp)
    return c.api.GetReactions(ref, slack.NewGetReactionsParameters())
}

// BotUserID returns the bot user ID by calling auth.test and caches the result
func (c *Client) BotUserID() (string, error) {
    if c.botUserID != "" {
        return c.botUserID, nil
    }
    auth, err := c.api.AuthTest()
    if err != nil {
        return "", err
    }
    c.botUserID = auth.UserID
    return c.botUserID, nil
}

// FindLatestPoll scans channel history using pagination until it finds the last poll message
func (c *Client) FindLatestPoll() (string, error) {
    params := &slack.GetConversationHistoryParameters{
        ChannelID: c.channelID,
        Limit:     100,
    }

    maxPages := 5
    for i := 0; i < maxPages; i++ {
        history, err := c.api.GetConversationHistory(params)
        if err != nil {
            return "", err
        }

        for _, msg := range history.Messages {
            if containsPollHeader(msg.Text) {
                return msg.Timestamp, nil
            }
        }

        // no more pages
        if history.ResponseMetaData == nil || history.ResponseMetaData.NextCursor == "" {
            break
        }
        params.Cursor = history.ResponseMetaData.NextCursor
    }

    return "", fmt.Errorf("no recent poll found in the last %d pages", maxPages)
}

// Helper function to verify if the message text matches our specific poll signature
func containsPollHeader(text string) bool {
    return strings.HasPrefix(text, "📊 *Weekly Poll*")
}
