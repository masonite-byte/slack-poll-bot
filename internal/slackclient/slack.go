package slackclient

import (
	"fmt"
	"log/slog"
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
	FindLatestPoll() (timestamp, slug string, err error)
	FindPollBySlug(slug string) (timestamp string, err error)
	FindPreviousWinner(slug string) (string, error)
	BotUserID() (string, error)
	ChannelID() string
	DeleteMessage(channelID, timestamp string) error
	SendDM(userID, text string) error
}

// New initializes the Slack client using environment variables and validates them
func New() *Client {
	token := os.Getenv("SLACK_BOT_TOKEN")
	channel := os.Getenv("SLACK_CHANNEL_ID")
	if token == "" || channel == "" {
		slog.Error("missing required env vars", "SLACK_BOT_TOKEN_set", token != "", "SLACK_CHANNEL_ID_set", channel != "")
		os.Exit(1)
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

// ChannelID returns the configured Slack channel ID.
func (c *Client) ChannelID() string {
	return c.channelID
}

// DeleteMessage deletes a message from the given channel by timestamp.
func (c *Client) DeleteMessage(channelID, timestamp string) error {
	_, _, err := c.api.DeleteMessage(channelID, timestamp)
	return err
}

// SendDM sends a direct message to a user by their Slack user ID.
func (c *Client) SendDM(userID, text string) error {
	_, _, err := c.api.PostMessage(userID, slack.MsgOptionText(text, false))
	return err
}

// pollHistoryMaxPages is the maximum number of 100-message pages scanned when
// searching for a poll. 5 pages = up to 500 recent messages, which is enough
// for any active channel while avoiding runaway API usage on quiet ones.
const pollHistoryMaxPages = 5

// FindLatestPoll scans channel history and returns the timestamp and slug of the most recent poll.
// The slug is the part after "poll_marker:" (e.g. "weekly", "runoff", "summer-sports").
func (c *Client) FindLatestPoll() (timestamp, slug string, err error) {
	params := &slack.GetConversationHistoryParameters{
		ChannelID: c.channelID,
		Limit:     100,
	}

	maxPages := pollHistoryMaxPages
	for i := 0; i < maxPages; i++ {
		history, err := c.api.GetConversationHistory(params)
		if err != nil {
			return "", "", err
		}

		for _, msg := range history.Messages {
			if s := pollMarkerSlug(msg); s != "" {
				return msg.Timestamp, s, nil
			}
		}

		if history.ResponseMetaData.NextCursor == "" {
			break
		}
		params.Cursor = history.ResponseMetaData.NextCursor
	}

	return "", "", fmt.Errorf("no recent poll found in the last %d pages", pollHistoryMaxPages)
}

// FindPollBySlug scans channel history and returns the timestamp of the most recent poll
// whose poll_marker slug matches the given slug.
func (c *Client) FindPollBySlug(slug string) (string, error) {
	params := &slack.GetConversationHistoryParameters{
		ChannelID: c.channelID,
		Limit:     100,
	}

	maxPages := pollHistoryMaxPages
	for i := 0; i < maxPages; i++ {
		history, err := c.api.GetConversationHistory(params)
		if err != nil {
			return "", err
		}
		for _, msg := range history.Messages {
			if pollMarkerSlug(msg) == slug {
				return msg.Timestamp, nil
			}
		}
		if history.ResponseMetaData.NextCursor == "" {
			break
		}
		params.Cursor = history.ResponseMetaData.NextCursor
	}
	return "", fmt.Errorf("no poll found with slug %q in the last %d pages", slug, maxPages)
}

// pollMarkerSlug extracts the slug from a poll_marker context block (e.g. "weekly", "summer-sports").
// Returns "" if the message has no poll marker.
func pollMarkerSlug(msg slack.Message) string {
	if msg.Blocks.BlockSet == nil {
		return ""
	}
	for _, block := range msg.Blocks.BlockSet {
		var ctx *slack.ContextBlock
		switch b := block.(type) {
		case *slack.ContextBlock:
			ctx = b
		case slack.ContextBlock:
			ctx = &b
		default:
			continue
		}
		if ctx.BlockID != "poll_marker" || len(ctx.ContextElements.Elements) == 0 {
			continue
		}
		if txt, ok := ctx.ContextElements.Elements[0].(*slack.TextBlockObject); ok {
			return strings.TrimPrefix(txt.Text, "poll_marker:")
		}
	}
	return ""
}

// FindPreviousWinner scans channel history for the most recent results message
// for the given poll slug and returns the winner, if there was one.
func (c *Client) FindPreviousWinner(slug string) (string, error) {
	if slug == "" {
		return "", nil
	}
	params := &slack.GetConversationHistoryParameters{
		ChannelID: c.channelID,
		Limit:     200,
	}

	maxPages := pollHistoryMaxPages
	for i := 0; i < maxPages; i++ {
		history, err := c.api.GetConversationHistory(params)
		if err != nil {
			return "", err
		}

		for _, msg := range history.Messages {
			if resultsMarkerSlug(msg) != slug {
				continue
			}
			// Try blocks first — more reliable than fallback text for Block Kit messages.
			winner := parseTopEventFromBlocks(msg)
			if winner == "" {
				winner = parseTopEvent(msg.Text)
			}
			if winner != "" {
				slog.Info("previous winner found", "slug", slug, "winner", winner)
				return winner, nil
			}
			slog.Info("results marker found but no winner could be parsed", "slug", slug)
			return "", nil
		}

		if history.ResponseMetaData.NextCursor == "" {
			break
		}
		params.Cursor = history.ResponseMetaData.NextCursor
	}

	return "", nil
}

// parseTopEventFromBlocks scans section blocks in a results message for the winner line.
func parseTopEventFromBlocks(msg slack.Message) string {
	if msg.Blocks.BlockSet == nil {
		return ""
	}
	for _, block := range msg.Blocks.BlockSet {
		var text string
		switch b := block.(type) {
		case *slack.SectionBlock:
			if b.Text != nil {
				text = b.Text.Text
			}
		case slack.SectionBlock:
			if b.Text != nil {
				text = b.Text.Text
			}
		default:
			continue
		}
		// Results summary block uses "@channel: Top event: X." format.
		text = strings.TrimPrefix(text, "@channel: ")
		if winner := parseTopEvent(text); winner != "" {
			return winner
		}
	}
	return ""
}

func containsPollMarker(msg slack.Message) bool {
	return pollMarkerSlug(msg) != ""
}

func resultsMarkerSlug(msg slack.Message) string {
	if msg.Blocks.BlockSet == nil {
		return ""
	}
	for _, block := range msg.Blocks.BlockSet {
		var ctx *slack.ContextBlock
		switch b := block.(type) {
		case *slack.ContextBlock:
			ctx = b
		case slack.ContextBlock:
			ctx = &b
		default:
			continue
		}
		if ctx.BlockID != "results_marker" || len(ctx.ContextElements.Elements) == 0 {
			continue
		}
		if txt, ok := ctx.ContextElements.Elements[0].(*slack.TextBlockObject); ok {
			return strings.TrimPrefix(txt.Text, "results_marker:")
		}
	}
	return ""
}

func parseTopEvent(text string) string {
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		const prefix = "Top event: "
		if strings.HasPrefix(line, prefix) {
			winner := strings.TrimPrefix(line, prefix)
			winner = strings.TrimSuffix(winner, ".")
			return strings.TrimSpace(winner)
		}
	}
	return ""
}
