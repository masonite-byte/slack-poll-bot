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
	"github.com/masonite-byte/slack-poll-bot/internal/testutil"
)

func TestSlashCommandResultsResponse(t *testing.T) {
	api := &testutil.MockAPI{
		Reactions: []slackclient.Reaction{{Name: "thumbsup", Count: 1, Users: []string{"U1"}}},
		BotID:     "B0",
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
	server := New(&testutil.MockAPI{}, "test-secret")
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
	server := New(&testutil.MockAPI{}, "test-secret")
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
	server := New(&testutil.MockAPI{}, "test-secret")
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
	api := &testutil.MockAPI{
		Reactions: []slackclient.Reaction{
			{Name: "thumbsup", Count: 2, Users: []string{"U1"}},
			{Name: "tada", Count: 2, Users: []string{"U2"}},
		},
		BotID: "B0",
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

func TestSlashCommandUnsupportedResponse(t *testing.T) {
	server := New(&testutil.MockAPI{}, "test-secret")
	form := url.Values{}
	form.Set("command", "/unknown")

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

	if !strings.Contains(payload["text"], "Unsupported slash command") {
		t.Fatalf("unexpected unsupported command response text: %q", payload["text"])
	}
}

func TestSlashCommandInvalidSignature(t *testing.T) {
	server := New(&testutil.MockAPI{}, "test-secret")
	form := url.Values{}
	form.Set("command", "/help")

	req := httptest.NewRequest(http.MethodPost, "/slack/commands", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	addSlackSignature(t, req, "wrong-secret")

	rr := httptest.NewRecorder()
	server.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 response, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "invalid signature") {
		t.Fatalf("expected invalid signature error body, got %q", rr.Body.String())
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
