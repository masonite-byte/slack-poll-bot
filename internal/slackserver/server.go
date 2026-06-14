package slackserver

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"

	"github.com/masonite-byte/slack-poll-bot/internal/runner"
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
	"github.com/slack-go/slack"
)

type Server struct {
	api           slackclient.API
	signingSecret string
}

func New(api slackclient.API, signingSecret string) *Server {
	return &Server{api: api, signingSecret: signingSecret}
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(s.handleSlash)
}

func (s *Server) handleSlash(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	sv, err := slack.NewSecretsVerifier(r.Header, s.signingSecret)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "unable to read request body", http.StatusInternalServerError)
		return
	}
	r.Body = io.NopCloser(bytes.NewBuffer(body))

	if _, err := sv.Write(body); err != nil {
		http.Error(w, "unable to verify signature", http.StatusInternalServerError)
		return
	}
	if err := sv.Ensure(); err != nil {
		http.Error(w, "invalid signature", http.StatusUnauthorized)
		return
	}

	cmd, err := slack.SlashCommandParse(r)
	if err != nil {
		http.Error(w, "failed to parse slash command", http.StatusBadRequest)
		return
	}

	var message string
	var responseErr error

	switch cmd.Command {
	case "/results", "/recount":
		message, responseErr = runner.BuildResultsMessage(s.api)
	case "/pollstatus":
		message, responseErr = runner.BuildPollStatusMessage(s.api)
	case "/newpoll":
		responseErr = runner.RunPostPoll(s.api)
		message = "New poll posted."
	case "/runoff":
		message, responseErr = runner.RunoffPoll(s.api)
	case "/options":
		message = runner.BuildOptionsText()
	case "/vote":
		message = runner.BuildVoteHelpText()
	case "/help":
		message = runner.BuildHelpText()
	default:
		message = "Unsupported slash command. Use /help to see available commands."
	}

	if responseErr != nil {
		log.Printf("error handling slash command %s: %v", cmd.Command, responseErr)
		s.writeJSON(w, http.StatusOK, map[string]string{
			"response_type": "ephemeral",
			"text":          "Error: " + responseErr.Error(),
		})
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]string{
		"response_type": "ephemeral",
		"text":          message,
	})
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
