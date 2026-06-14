package slackserver

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
	"github.com/slack-go/slack"
)

type mockAPI struct {
	reactions []slackclient.Reaction
	botID     string
}

func (m *mockAPI) PostMessage(text string) (string, string, error) {
	return "C", "123", nil
}
func (m *mockAPI) PostBlocks(text string, blocks ...slack.Block) (string, string, error) {
	return "C", "123", nil
}
func (m *mockAPI) AddReaction(name, timestamp string) error {
	return nil
}
func (m *mockAPI) GetReactions(timestamp string) ([]slackclient.Reaction, error) {
	return m.reactions, nil
}
func (m *mockAPI) FindLatestPoll() (string, error) { return "123", nil }
func (m *mockAPI) BotUserID() (string, error)      { return m.botID, nil }

func TestSlashCommandResultsResponse(t *testing.T) {
	api := &mockAPI{
		reactions: []slackclient.Reaction{{Name: "thumbsup", Count: 1, Users: []string{"U1"}}},
		botID:     "B0",
	}
	server := New(api, "test-secret")

	form := url.Values{}
	form.Set("command", "/results")
	form.Set("text", "")

	req := httptest.NewRequest(http.MethodPost, "/slack/commands", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	addSlackSignature(t, req, "test-secret")

	rr := httptest.NewRecorder()
	server.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 response, got %d", rr.Code)
	}

	var payload map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("failed to decode response JSON: %v", err)
	}

	if payload["response_type"] != "ephemeral" {
		t.Fatalf("expected ephemeral response, got %q", payload["response_type"])
	}
	if !strings.Contains(payload["text"], "Final Poll Results") {
		t.Fatalf("unexpected response text: %q", payload["text"])
	}
}

func TestSlashCommandHelpResponse(t *testing.T) {
	server := New(&mockAPI{}, "test-secret")
	form := url.Values{}
	form.Set("command", "/help")

	req := httptest.NewRequest(http.MethodPost, "/slack/commands", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	addSlackSignature(t, req, "test-secret")

	rr := httptest.NewRecorder()
	server.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 response, got %d", rr.Code)
	}

	var payload map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("failed to decode response JSON: %v", err)
	}

	if !strings.Contains(payload["text"], "Supported slash commands") {
		t.Fatalf("unexpected help response text: %q", payload["text"])
	}
}

func TestSlashCommandOptionsResponse(t *testing.T) {
	server := New(&mockAPI{}, "test-secret")
	form := url.Values{}
	form.Set("command", "/options")

	req := httptest.NewRequest(http.MethodPost, "/slack/commands", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	addSlackSignature(t, req, "test-secret")

	rr := httptest.NewRecorder()
	server.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 response, got %d", rr.Code)
	}

	var payload map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("failed to decode response JSON: %v", err)
	}

	if !strings.Contains(payload["text"], "Available poll options") {
		t.Fatalf("unexpected options response text: %q", payload["text"])
	}
}

func TestSlashCommandNewPollResponse(t *testing.T) {
	server := New(&mockAPI{}, "test-secret")
	form := url.Values{}
	form.Set("command", "/newpoll")

	req := httptest.NewRequest(http.MethodPost, "/slack/commands", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	addSlackSignature(t, req, "test-secret")

	rr := httptest.NewRecorder()
	server.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 response, got %d", rr.Code)
	}

	var payload map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("failed to decode response JSON: %v", err)
	}

	if !strings.Contains(payload["text"], "New poll posted") {
		t.Fatalf("unexpected newpoll response text: %q", payload["text"])
	}
}

func TestSlashCommandRunoffResponse(t *testing.T) {
	api := &mockAPI{
		reactions: []slackclient.Reaction{
			{Name: "thumbsup", Count: 2, Users: []string{"U1"}},
			{Name: "tada", Count: 2, Users: []string{"U2"}},
		},
		botID: "B0",
	}
	server := New(api, "test-secret")
	form := url.Values{}
	form.Set("command", "/runoff")

	req := httptest.NewRequest(http.MethodPost, "/slack/commands", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	addSlackSignature(t, req, "test-secret")

	rr := httptest.NewRecorder()
	server.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 response, got %d", rr.Code)
	}

	var payload map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&payload); err != nil {
		t.Fatalf("failed to decode response JSON: %v", err)
	}

	if !strings.Contains(payload["text"], "Runoff poll posted") {
		t.Fatalf("unexpected runoff response text: %q", payload["text"])
	}
}

func addSlackSignature(t *testing.T, req *http.Request, secret string) {
	t.Helper()
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	req.Header.Set("X-Slack-Request-Timestamp", timestamp)

	baseString := "v0:" + timestamp + ":" + readBody(req)
	h := hmac.New(sha256.New, []byte(secret))
	_, _ = h.Write([]byte(baseString))
	sig := "v0=" + hex.EncodeToString(h.Sum(nil))
	req.Header.Set("X-Slack-Signature", sig)
}

func readBody(req *http.Request) string {
	body, _ := io.ReadAll(req.Body)
	req.Body = io.NopCloser(bytes.NewBuffer(body))
	return string(body)
}
