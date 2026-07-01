package runner

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/masonite-byte/slack-poll-bot/internal/poll"
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
	"github.com/masonite-byte/slack-poll-bot/internal/testutil"
	"github.com/slack-go/slack"
)

func chdirToRepoRoot(t *testing.T) {
	t.Helper()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	if err := os.Chdir(filepath.Join("..", "..")); err != nil {
		t.Fatalf("Chdir: %v", err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(cwd); err != nil {
			t.Fatalf("restore cwd: %v", err)
		}
	})
}

func TestRunPostPollSeedsReactions(t *testing.T) {
	chdirToRepoRoot(t)
	weeklyPoll, err := poll.LoadCustomPoll("weekly")
	if err != nil {
		t.Fatalf("load weekly poll: %v", err)
	}
	m := &testutil.MockAPI{Ts: "123"}
	if err := RunPostPoll(m); err != nil {
		t.Fatalf("RunPostPoll error: %v", err)
	}
	if m.Posted == "" {
		t.Fatalf("expected post to be sent")
	}
	// Button-based polls seed no reactions; reaction-based polls seed one per option.
	expected := len(weeklyPoll.Options)
	if weeklyPoll.VotingMode == "button" {
		expected = 0
	}
	if len(m.Added) != expected {
		t.Fatalf("expected %d seeded reactions (voting_mode=%q), got %d", expected, weeklyPoll.VotingMode, len(m.Added))
	}
}

func TestRunPostPollExcludesPreviousWinnerFromStoredWeeklyPoll(t *testing.T) {
	chdirToRepoRoot(t)
	weeklyPoll, err := poll.LoadCustomPoll("weekly")
	if err != nil {
		t.Fatalf("load weekly poll: %v", err)
	}
	m := &testutil.MockAPI{Ts: "123", PreviousWinnerBySlug: map[string]string{"weekly": "Soccer"}}
	if err := RunPostPoll(m); err != nil {
		t.Fatalf("RunPostPoll error: %v", err)
	}
	if weeklyPoll.VotingMode == "button" {
		// For button polls, verify Soccer's option block was not included in the posted blocks.
		for _, block := range m.PostedBlocks {
			section, ok := block.(*slack.SectionBlock)
			if !ok || section.Accessory == nil {
				continue
			}
			if section.Text != nil && strings.Contains(section.Text.Text, "Soccer") {
				t.Fatalf("expected Soccer to be excluded from button poll blocks")
			}
		}
	} else {
		// For reaction polls, verify Soccer's reaction was not seeded.
		for _, reaction := range m.Added {
			if reaction == "soccer" {
				t.Fatalf("expected previous winner reaction to be excluded, got %v", m.Added)
			}
		}
	}
}

func TestRunResultsComputesCounts(t *testing.T) {
	m := &testutil.MockAPI{Ts: "321", BotID: "B0", Reactions: []slackclient.Reaction{
		{Name: "thumbsup", Count: 2, Users: []string{"B0", "U1"}},
		{Name: "tada", Count: 1, Users: []string{"U2"}},
	}}

	out, isTie, err := RunResults(m)
	if err != nil {
		t.Fatalf("RunResults error: %v", err)
	}
	if out == "" {
		t.Fatalf("expected final message content")
	}
	if len(m.Posted) == 0 {
		t.Fatalf("expected summary to be posted")
	}
	if !isTie {
		t.Fatalf("expected tie to be detected (thumbsup=1 vs tada=1 after deducting bot)")
	}
}

func TestBuildResultsReportsTopEvent(t *testing.T) {
	reactions := []slackclient.Reaction{
		{Name: "soccer", Count: 3, Users: []string{"U1", "B0"}},
		{Name: "basketball", Count: 1, Users: []string{"U2"}},
	}

	result := BuildResults(tallyResults(reactions, "B0", nil))
	if !strings.Contains(result, "Top event: Soccer.") {
		t.Fatalf("expected top event summary for Soccer, got %q", result)
	}
}

func TestBuildResultsBlocksIncludesResultsMarker(t *testing.T) {
	blocks := BuildResultsBlocks([]pollResult{{Name: "soccer", Label: "Soccer", Count: 3}}, "weekly")
	action, ok := blocks[len(blocks)-2].(*slack.ActionBlock)
	if !ok {
		t.Fatalf("expected delete action before results marker, got %T", blocks[len(blocks)-2])
	}
	button := action.Elements.ElementSet[0].(*slack.ButtonBlockElement)
	if button.ActionID != "admin_delete_message" {
		t.Fatalf("expected admin delete action_id, got %q", button.ActionID)
	}

	last := blocks[len(blocks)-1]
	ctx, ok := last.(*slack.ContextBlock)
	if !ok {
		t.Fatalf("expected last block to be results context, got %T", last)
	}
	text := ctx.ContextElements.Elements[0].(*slack.TextBlockObject)
	if text.Text != "results_marker:weekly" {
		t.Fatalf("expected weekly results marker, got %q", text.Text)
	}
}

func TestBuildResultsReportsTie(t *testing.T) {
	reactions := []slackclient.Reaction{
		{Name: "soccer", Count: 1, Users: []string{"U1"}},
		{Name: "basketball", Count: 1, Users: []string{"U2"}},
	}

	result := BuildResults(tallyResults(reactions, "B0", nil))
	if !strings.Contains(result, "It's a tie between Basketball and Soccer.") {
		t.Fatalf("expected tie summary for Basketball and Soccer, got %q", result)
	}
}

func TestBuildResultsNoVotes(t *testing.T) {
	result := BuildResults(nil)
	if !strings.Contains(result, "No votes have been cast yet.") {
		t.Fatalf("expected no votes summary, got %q", result)
	}
}

func TestBuildResultsIgnoresBotOnlyReaction(t *testing.T) {
	reactions := []slackclient.Reaction{{Name: "+1", Count: 1, Users: []string{"B0"}}}
	result := BuildResults(tallyResults(reactions, "B0", nil))
	if !strings.Contains(result, "No votes have been cast yet.") {
		t.Fatalf("expected bot-only reaction to be ignored, got %q", result)
	}
}

func TestBuildResultsUnknownEmojiLabelFallsBack(t *testing.T) {
	reactions := []slackclient.Reaction{{Name: "heart", Count: 2, Users: []string{"U1", "U2"}}}
	result := BuildResults(tallyResults(reactions, "B0", nil))
	if !strings.Contains(result, "heart received 2 votes") {
		t.Fatalf("expected fallback label for unknown reaction, got %q", result)
	}
}

func TestRunoffPollNoVotes(t *testing.T) {
	m := &testutil.MockAPI{Ts: "321", BotID: "B0", Reactions: []slackclient.Reaction{}}
	result, err := RunoffPoll(m)
	if err != nil {
		t.Fatalf("RunoffPoll error: %v", err)
	}
	if !strings.Contains(result, "No votes have been cast yet. Runoff requires at least one vote.") {
		t.Fatalf("unexpected runoff result for no votes: %q", result)
	}
}

func TestRunoffPollNoRunoffWhenLeader(t *testing.T) {
	m := &testutil.MockAPI{Ts: "321", BotID: "B0", Reactions: []slackclient.Reaction{
		{Name: "soccer", Count: 3, Users: []string{"U1"}},
		{Name: "basketball", Count: 1, Users: []string{"U2"}},
	}}
	result, err := RunoffPoll(m)
	if err != nil {
		t.Fatalf("RunoffPoll error: %v", err)
	}
	if !strings.Contains(result, "No runoff required. Current leader is Soccer.") {
		t.Fatalf("unexpected runoff result when leader exists: %q", result)
	}
	if m.Posted != "" {
		t.Fatalf("expected no new poll posted when no runoff is needed, got %q", m.Posted)
	}
}

func TestRunResultsForSlugPostsRunoffOnTie(t *testing.T) {
	chdirToRepoRoot(t)
	m := &testutil.MockAPI{
		Ts:    "321",
		BotID: "B0",
		Reactions: []slackclient.Reaction{
			{Name: "one", Count: 1, Users: []string{"U1"}},
			{Name: "two", Count: 1, Users: []string{"U2"}},
		},
	}

	if err := RunResultsForSlug(m, "schedule-test"); err != nil {
		t.Fatalf("RunResultsForSlug error: %v", err)
	}
	if len(m.Deleted) != 1 || m.Deleted[0] != "321" {
		t.Fatalf("expected original poll to be deleted before runoff, got %v", m.Deleted)
	}
	if len(m.Added) != 2 || m.Added[0] != "one" || m.Added[1] != "two" {
		t.Fatalf("expected runoff reactions to be seeded, got %v", m.Added)
	}
	if !strings.Contains(m.Posted, "Runoff Poll") {
		t.Fatalf("expected runoff poll to be posted, got %q", m.Posted)
	}
}

func TestRunResultsNoPollFoundReturnsErrAndPostsMessage(t *testing.T) {
	m := &testutil.MockAPI{
		FindLatestPollErr: fmt.Errorf("no recent poll found in the last 5 pages"),
	}
	_, _, err := RunResults(m)
	if !errors.Is(err, ErrNoPollFound) {
		t.Fatalf("expected ErrNoPollFound, got %v", err)
	}
	if !strings.Contains(m.Posted, "No active poll found") {
		t.Fatalf("expected 'No active poll found' message posted to channel, got %q", m.Posted)
	}
}

func TestRunResultsOtherErrorPropagates(t *testing.T) {
	m := &testutil.MockAPI{
		FindLatestPollErr: fmt.Errorf("network timeout"),
	}
	_, _, err := RunResults(m)
	if errors.Is(err, ErrNoPollFound) {
		t.Fatal("expected non-ErrNoPollFound error to propagate, got ErrNoPollFound")
	}
	if err == nil {
		t.Fatal("expected error to propagate, got nil")
	}
}

func TestRunPostCustomPollSeedsReactions(t *testing.T) {
	m := &testutil.MockAPI{Ts: "123"}
	p := &poll.CustomPoll{Name: "Test Poll", Options: []string{"Alpha", "Beta", "Gamma"}, Slug: "test-poll"}
	if err := RunPostCustomPoll(m, p); err != nil {
		t.Fatalf("RunPostCustomPoll error: %v", err)
	}
	if m.Posted == "" {
		t.Fatal("expected poll message to be posted")
	}
	if len(m.Added) != 3 {
		t.Fatalf("expected 3 seeded reactions, got %d", len(m.Added))
	}
	if m.Added[0] != "one" || m.Added[1] != "two" || m.Added[2] != "three" {
		t.Fatalf("expected reactions [one two three], got %v", m.Added)
	}
}

func TestRunPostCustomPollButtonModeNoReactionsSeeded(t *testing.T) {
	m := &testutil.MockAPI{Ts: "456"}
	p := &poll.CustomPoll{Name: "Button Poll", Options: []string{"A", "B"}, Slug: "button-poll", VotingMode: "button"}
	if err := RunPostCustomPoll(m, p); err != nil {
		t.Fatalf("RunPostCustomPoll error: %v", err)
	}
	if m.Posted == "" {
		t.Fatal("expected poll message to be posted")
	}
	if len(m.Added) != 0 {
		t.Fatalf("button mode: expected no seeded reactions, got %v", m.Added)
	}
}

func TestRunPostCustomPollExcludesPreviousWinnerWhenConfigured(t *testing.T) {
	m := &testutil.MockAPI{
		Ts:                   "789",
		PreviousWinnerBySlug: map[string]string{"weekly": "Soccer"},
	}
	p := &poll.CustomPoll{
		Name:                  "Weekly Sports Poll",
		Options:               []string{"Soccer", "Basketball", "Volleyball"},
		Emojis:                []string{"soccer", "basketball", "volleyball"},
		Slug:                  "weekly",
		ExcludePreviousWinner: true,
	}
	if err := RunPostCustomPoll(m, p); err != nil {
		t.Fatalf("RunPostCustomPoll error: %v", err)
	}
	for _, reaction := range m.Added {
		if reaction == "soccer" {
			t.Fatalf("expected Soccer to be excluded, got %v", m.Added)
		}
	}
	if !strings.Contains(m.Posted, "Last posted winner, Soccer, is excluded.") {
		t.Fatalf("expected exclusion note in posted text, got %q", m.Posted)
	}
}

func TestRunPostCustomPollUsesWinnerStateFileOverChannelScan(t *testing.T) {
	chdirToRepoRoot(t)
	// Write a winner state file that says Soccer won.
	stateFile := filepath.Join("polls", "_winner_state.json")
	if err := os.WriteFile(stateFile, []byte(`{"state-file-test": "Soccer"}`), 0644); err != nil {
		t.Fatalf("write winner state: %v", err)
	}
	t.Cleanup(func() { os.Remove(stateFile) })

	// MockAPI returns a DIFFERENT winner from channel history — state file should win.
	m := &testutil.MockAPI{
		Ts:                   "789",
		PreviousWinnerBySlug: map[string]string{"state-file-test": "Basketball"},
	}
	p := &poll.CustomPoll{
		Name:                  "State File Test Poll",
		Options:               []string{"Soccer", "Basketball", "Volleyball"},
		Emojis:                []string{"soccer", "basketball", "volleyball"},
		Slug:                  "state-file-test",
		ExcludePreviousWinner: true,
	}
	if err := RunPostCustomPoll(m, p); err != nil {
		t.Fatalf("RunPostCustomPoll error: %v", err)
	}
	// Soccer (from state file) should be excluded, not Basketball (from mock channel scan).
	for _, reaction := range m.Added {
		if reaction == "soccer" {
			t.Fatalf("expected Soccer (state file winner) to be excluded, got reactions %v", m.Added)
		}
	}
	if !strings.Contains(m.Posted, "Last posted winner, Soccer, is excluded.") {
		t.Fatalf("expected Soccer exclusion note, got %q", m.Posted)
	}
}
