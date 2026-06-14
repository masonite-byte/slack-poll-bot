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

// Reaction is a lightweight representation of slack.ItemReaction used by callers/tests.
type Reaction struct {
	Name  string
	Count int
	Users []string
}

// API defines the subset of Slack operations used by the application.
type API interface {
	PostMessage(text string) (string, string, error)
	PostBlocks(text string, blocks ...slack.Block) (string, string, error)
	AddReaction(name, timestamp string) error
	GetReactions(timestamp string) ([]Reaction, error)
	FindLatestPoll() (string, error)
	BotUserID() (string, error)
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

// PostBlocks sends a Block Kit message with fallback text to the configured channel
func (c *Client) PostBlocks(text string, blocks ...slack.Block) (string, string, error) {
	return c.api.PostMessage(
		c.channelID,
		slack.MsgOptionText(text, false),
		slack.MsgOptionBlocks(blocks...),
	)
}

// AddReaction attaches an emoji reaction to a posted message
func (c *Client) AddReaction(name, timestamp string) error {
	ref := slack.NewRefToMessage(c.channelID, timestamp)
	return c.api.AddReaction(name, ref)
}

// GetReactions retrieves all emoji counts attached to a given message timestamp
func (c *Client) GetReactions(timestamp string) ([]Reaction, error) {
	ref := slack.NewRefToMessage(c.channelID, timestamp)
	items, err := c.api.GetReactions(ref, slack.NewGetReactionsParameters())
	if err != nil {
		return nil, err
	}
	out := make([]Reaction, 0, len(items))
	for _, it := range items {
		out = append(out, Reaction{
			Name:  it.Name,
			Count: it.Count,
			Users: it.Users,
		})
	}
	return out, nil
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
			if containsPollMarker(msg) || containsPollHeader(msg.Text) {
				return msg.Timestamp, nil
			}
		}

		// no more pages
		if history.ResponseMetaData.NextCursor == "" {
			break
		}
		params.Cursor = history.ResponseMetaData.NextCursor
	}

	return "", fmt.Errorf("no recent poll found in the last %d pages", maxPages)
}

func containsPollMarker(msg slack.Message) bool {
	if msg.Blocks.BlockSet == nil {
		return false
	}

	for _, block := range msg.Blocks.BlockSet {
		switch ctx := block.(type) {
		case *slack.ContextBlock:
			if ctx.BlockID != "poll_marker" {
				continue
			}
			for _, element := range ctx.ContextElements.Elements {
				switch textElem := element.(type) {
				case *slack.TextBlockObject:
					if strings.Contains(textElem.Text, "poll_marker:weekly") {
						return true
					}
				case slack.TextBlockObject:
					if strings.Contains(textElem.Text, "poll_marker:weekly") {
						return true
					}
				}
			}
		case slack.ContextBlock:
			if ctx.BlockID != "poll_marker" {
				continue
			}
			for _, element := range ctx.ContextElements.Elements {
				switch textElem := element.(type) {
				case *slack.TextBlockObject:
					if strings.Contains(textElem.Text, "poll_marker:weekly") {
						return true
					}
				case slack.TextBlockObject:
					if strings.Contains(textElem.Text, "poll_marker:weekly") {
						return true
					}
				}
			}
		}
	}

	return false
}

// Helper function to verify if the message text matches our specific poll signature
func containsPollHeader(text string) bool {
	return strings.HasPrefix(text, "📊 *Weekly Poll*")
}
