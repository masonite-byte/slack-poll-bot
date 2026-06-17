package runner

import (
	"errors"
	"fmt"
	"log/slog"
	"math/rand"
	"os"
	"sort"
	"strings"

	"github.com/masonite-byte/slack-poll-bot/internal/poll"
	"github.com/masonite-byte/slack-poll-bot/internal/slackclient"
	"github.com/slack-go/slack"
)

// ErrNoPollFound is returned when no active poll exists in the channel.
var ErrNoPollFound = errors.New("no active poll found")

var winnerMessages = []string{
	"Congratulations... your sheep mentality paid off. *%s* won! 🐑",
	"Democracy has spoken and for once you were on the right side. *%s* won! 🎉",
	"Your vote actually counted for something. Shocking, we know. *%s* won! 🏆",
	"You backed the right horse this time. *%s* won! 🐴",
	"Even a broken clock is right twice a day. *%s* won! ⏰",
	"Popular opinion prevails, and so do you. *%s* won! 🥇",
	"The herd has spoken, and you were proudly part of it. *%s* won! 🎊",
	"You voted with the majority. Truly a courageous act of absolutely no independent thought. *%s* won! 🧠",
	"Incredible. You picked the most popular option. A bold, safe, utterly predictable move. *%s* won! 👏",
	"Science has yet to determine whether you predicted this or just got lucky. Either way, *%s* won! 🔬",
	"Your ancestors are weeping tears of joy. Or they would be, if they cared about this. *%s* won! 👴",
	"Against all odds — well, actually with all odds — *%s* won and so did you! 📊",
	"You voted for *%s* and it won. Please do not let this go to your head. We're begging you. 🙏",
	"The algorithm has determined you made the correct choice this week. Do not expect consistency. *%s* won! 🤖",
}

var tieMessages = []string{
	"It's a tie! Democracy has collapsed. A runoff poll is being posted — go finish what you started. 🗳️",
	"Incredible. You and your coworkers managed to be equally wrong. A runoff has been posted. 🤝",
	"The people are divided. A runoff poll is live — please do better this time. ⚔️",
	"Your collective indecision has triggered a runoff. Congratulations on nothing. Go vote again. 🙃",
	"A tie has been detected. Scientists are baffled. A runoff poll awaits you. 🔬",
	"The algorithm is upset. There is a tie. A runoff is being posted. Fix this. 🤖",
	"History will record this as the day your office couldn't make up its mind. Runoff poll is up. 📜",
}

var loserMessages = []string{
	"James Maddison sympathizes with you... *%s* won. Your choice didn't make the cut. 💔",
	"The tyranny of the majority strikes again. *%s* won. Your vote was noted... and ignored. 🗳️",
	"Bold choice. Wrong choice. *%s* won. 😬",
	"Not everyone can be right. *%s* won. Better luck next week! 😔",
	"The people have spoken, and they said 'not that'. *%s* won. 😅",
	"Your participation trophy is in the mail. *%s* won. 🏅",
	"History is written by the winners, and you are not in it. *%s* won. 📜",
	"We have reviewed your vote. We have concerns. *%s* won. 🔎",
	"At least you voted. That's genuinely the nicest thing we can say right now. *%s* won. 🕊️",
	"A moment of silence for your pick, which has been decisively rejected by your peers. *%s* won. 🪦",
	"Your taste has been evaluated by a panel of your coworkers and found lacking. *%s* won. 🧑‍⚖️",
	"The ghost of your choice will haunt the break room. *%s* won. 👻",
	"In an alternate universe your pick won. Unfortunately you live in this one. *%s* won. 🌍",
	"Your vote has been carefully considered and ceremonially thrown in the bin. *%s* won. 🗑️",
	"Statistically, this was always going to happen. Maybe reconsider your entire worldview. *%s* won. 📉",
}

type pollResult struct {
	Name  string
	Label string
	Count int
}

// RunPostPoll posts the poll and seeds initial reactions using the provided API.
// If a previous winner is found in channel history, that option is excluded from the poll.
func RunPostPoll(api slackclient.API) error {
	previousWinner, err := api.FindPreviousWinner()
	if err != nil {
		slog.Warn("could not determine previous winner, including all options", "error", err)
	}

	var instance poll.PollInstance
	var blocks []slack.Block
	if previousWinner != "" {
		slog.Info("excluding previous winner from poll", "winner", previousWinner)
		instance = poll.GetWeeklyPollExcluding(previousWinner)
		blocks = poll.WeeklyPollBlocksExcluding(previousWinner)
	} else {
		instance = poll.GetWeeklyPoll()
		blocks = poll.WeeklyPollBlocks()
	}

	_, timestamp, err := api.PostBlocks(instance.Text, blocks...)
	if err != nil {
		return err
	}

	for _, e := range instance.Emojis {
		if err := api.AddReaction(e, timestamp); err != nil {
			slog.Warn("failed to seed reaction", "emoji", e, "error", err)
		}
	}
	return nil
}

// RunResults finds the latest poll, computes vote counts (excluding bot), posts the summary,
// and returns the message and whether the top options are tied.
func RunResults(api slackclient.API) (string, bool, error) {
	timestamp, slug, err := api.FindLatestPoll()
	if err != nil {
		if strings.Contains(err.Error(), "no recent poll found") {
			api.PostBlocks("⚠️ No active poll found in this channel. Use `/newpoll` to post one first.")
			return "", false, ErrNoPollFound
		}
		return "", false, err
	}

	reactions, err := api.GetReactions(timestamp)
	if err != nil {
		return "", false, err
	}

	botID, err := api.BotUserID()
	if err != nil {
		return "", false, err
	}

	labels := buildLabelMap(slug)
	results := tallyResults(reactions, botID, labels)
	message := BuildResults(results)
	blocks := BuildResultsBlocks(results)
	if _, _, err := api.PostBlocks(message, blocks...); err != nil {
		slog.Error("failed to post results", "error", err)
	}

	sendAdminDM(api, buildAdminVoterSummary(slug, reactions, botID, labels))

	maxCount, winning := findWinners(results)
	isTie := maxCount > 0 && len(winning) > 1
	return message, isTie, nil
}

// BuildResultsMessage computes the results summary from Slack and returns the final text.
func BuildResultsMessage(api slackclient.API) (string, error) {
	timestamp, slug, err := api.FindLatestPoll()
	if err != nil {
		slog.Error("BuildResultsMessage: FindLatestPoll failed", "error", err)
		return "", err
	}

	reactions, err := api.GetReactions(timestamp)
	if err != nil {
		slog.Error("BuildResultsMessage: GetReactions failed", "error", err)
		return "", err
	}

	botID, err := api.BotUserID()
	if err != nil {
		slog.Error("BuildResultsMessage: BotUserID failed", "error", err)
		return "", err
	}

	return BuildResults(tallyResults(reactions, botID, buildLabelMap(slug))), nil
}

// BuildResults generates a text report and appends the highest-voted event or tie summary.
func BuildResults(results []pollResult) string {
	lines := []string{"📊 *Final Poll Results Are In!*"}
	for _, result := range results {
		lines = append(lines, fmt.Sprintf("    :%s: %s received %d votes", result.Name, result.Label, result.Count))
	}

	maxCount, winning := findWinners(results)

	if maxCount <= 0 {
		lines = append(lines, "No votes have been cast yet.")
	} else if len(winning) == 1 {
		lines = append(lines, fmt.Sprintf("Top event: %s.", winning[0]))
	} else {
		lines = append(lines, fmt.Sprintf("It's a tie between %s.", strings.Join(winning, " and ")))
	}

	return strings.Join(lines, "\n")
}

// BuildResultsBlocks returns Block Kit blocks for the results summary, matching the poll message style.
func BuildResultsBlocks(results []pollResult) []slack.Block {
	header := slack.NewSectionBlock(
		slack.NewTextBlockObject("mrkdwn", "📊 *Final Poll Results Are In!*", false, false),
		nil, nil,
	)
	blocks := []slack.Block{header}

	for _, result := range results {
		line := fmt.Sprintf("    :%s: %s — %d votes", result.Name, result.Label, result.Count)
		blocks = append(blocks, slack.NewSectionBlock(
			slack.NewTextBlockObject("mrkdwn", line, false, false),
			nil, nil,
		))
	}

	maxCount, winning := findWinners(results)

	var summary string
	if maxCount <= 0 {
		summary = "@channel: No votes have been cast yet."
	} else if len(winning) == 1 {
		summary = fmt.Sprintf("@channel: Top event: %s.", winning[0])
	} else {
		summary = fmt.Sprintf("@channel: It's a tie between %s.", strings.Join(winning, " and "))
	}
	blocks = append(blocks, slack.NewSectionBlock(
		slack.NewTextBlockObject("mrkdwn", summary, false, false),
		nil, nil,
	))

	return blocks
}

func BuildPollStatusMessage(api slackclient.API) (string, error) {
	timestamp, slug, err := api.FindLatestPoll()
	if err != nil {
		return "", err
	}

	reactions, err := api.GetReactions(timestamp)
	if err != nil {
		return "", err
	}

	botID, err := api.BotUserID()
	if err != nil {
		return "", err
	}

	summary := BuildResults(tallyResults(reactions, botID, buildLabelMap(slug)))
	return fmt.Sprintf("Current poll status (posted at %s):\n%s", timestamp, summary), nil
}

func RunoffPoll(api slackclient.API) (string, error) {
	timestamp, slug, err := api.FindLatestPoll()
	if err != nil {
		return "", err
	}

	reactions, err := api.GetReactions(timestamp)
	if err != nil {
		return "", err
	}

	botID, err := api.BotUserID()
	if err != nil {
		return "", err
	}

	results := tallyResults(reactions, botID, buildLabelMap(slug))
	if len(results) == 0 {
		return "No votes have been cast yet. Runoff requires at least one vote.", nil
	}

	maxCount, winning := findWinners(results)

	if maxCount <= 0 {
		return "No votes have been cast yet. Runoff requires at least one vote.", nil
	}
	if len(winning) < 2 {
		return fmt.Sprintf("No runoff required. Current leader is %s.", winning[0]), nil
	}
	channelID := api.ChannelID()
	err = api.DeleteMessage(channelID, timestamp) // delete past poll to prevent confusion
	if err != nil {
		return "", err
	}

	instance := poll.GetRunoffPoll(winning)
	blocks := poll.RunoffPollBlocks(winning)
	_, timestamp, err = api.PostBlocks(instance.Text, blocks...)
	if err != nil {
		return "", err
	}
	for _, e := range instance.Emojis {
		if err := api.AddReaction(e, timestamp); err != nil {
			slog.Warn("failed to seed runoff reaction", "emoji", e, "error", err)
		}
	}

	return fmt.Sprintf("Runoff poll posted with tied options: %s.", strings.Join(winning, ", ")), nil
}

// NotifyVoters DMs each voter once with a randomly chosen winner or loser message.
// If a voter backed multiple options and one of them won, they are treated as a winner.
func NotifyVoters(api slackclient.API) error {
	timestamp, slug, err := api.FindLatestPoll()
	if err != nil {
		return err
	}

	reactions, err := api.GetReactions(timestamp)
	if err != nil {
		return err
	}

	botID, err := api.BotUserID()
	if err != nil {
		return err
	}

	labels := buildLabelMap(slug)
	results := tallyResults(reactions, botID, labels)
	maxCount, winning := findWinners(results)
	isTie := maxCount > 0 && len(winning) > 1
	winnerLabel := strings.Join(winning, " and ")

	winningSet := make(map[string]bool, len(winning))
	for _, w := range winning {
		winningSet[w] = true
	}

	// Build a map of userID → whether they voted for a winning option
	votedForWinner := make(map[string]bool)
	seen := make(map[string]bool)

	for _, reaction := range reactions {
		label := resolveLabel(reaction.Name, labels)
		for _, userID := range reaction.Users {
			if userID == botID {
				continue
			}
			seen[userID] = true
			if winningSet[label] {
				votedForWinner[userID] = true
			}
		}
	}

	for userID := range seen {
		var msg string
		if isTie {
			msg = tieMessages[rand.Intn(len(tieMessages))]
		} else if votedForWinner[userID] {
			msg = fmt.Sprintf(winnerMessages[rand.Intn(len(winnerMessages))], winnerLabel)
		} else {
			msg = fmt.Sprintf(loserMessages[rand.Intn(len(loserMessages))], winnerLabel)
		}
		if err := api.SendDM(userID, msg); err != nil {
			slog.Warn("failed to DM voter", "userID", userID, "error", err)
		}
	}

	return nil
}

// RunResultsForSlug finds the most recent poll with the given slug, tallies results, posts them,
// notifies voters with DMs, and deletes the original poll.
func RunResultsForSlug(api slackclient.API, slug string) error {
	timestamp, err := api.FindPollBySlug(slug)
	if err != nil {
		if strings.Contains(err.Error(), "no poll found") {
			return ErrNoPollFound
		}
		return err
	}

	reactions, err := api.GetReactions(timestamp)
	if err != nil {
		return err
	}

	botID, err := api.BotUserID()
	if err != nil {
		return err
	}

	labels := buildLabelMap(slug)
	results := tallyResults(reactions, botID, labels)
	message := BuildResults(results)
	blocks := BuildResultsBlocks(results)
	if _, _, err := api.PostBlocks(message, blocks...); err != nil {
		slog.Error("failed to post results", "error", err)
	}

	sendAdminDM(api, buildAdminVoterSummary(slug, reactions, botID, labels))

	maxCount, winning := findWinners(results)
	isTie := maxCount > 0 && len(winning) > 1
	winnerLabel := strings.Join(winning, " and ")

	winningSet := make(map[string]bool, len(winning))
	for _, w := range winning {
		winningSet[w] = true
	}

	votedForWinner := make(map[string]bool)
	seen := make(map[string]bool)

	for _, reaction := range reactions {
		label := resolveLabel(reaction.Name, labels)
		for _, userID := range reaction.Users {
			if userID == botID {
				continue
			}
			seen[userID] = true
			if winningSet[label] {
				votedForWinner[userID] = true
			}
		}
	}

	for userID := range seen {
		var msg string
		if isTie {
			msg = tieMessages[rand.Intn(len(tieMessages))]
		} else if votedForWinner[userID] {
			msg = fmt.Sprintf(winnerMessages[rand.Intn(len(winnerMessages))], winnerLabel)
		} else {
			msg = fmt.Sprintf(loserMessages[rand.Intn(len(loserMessages))], winnerLabel)
		}
		if err := api.SendDM(userID, msg); err != nil {
			slog.Warn("failed to DM voter", "userID", userID, "error", err)
		}
	}

	if err := api.DeleteMessage(api.ChannelID(), timestamp); err != nil {
		slog.Warn("failed to delete poll after posting results", "slug", slug, "error", err)
	}

	return nil
}

// RunPostCustomPoll posts a user-created custom poll and seeds its reactions.
func RunPostCustomPoll(api slackclient.API, p *poll.CustomPoll) error {
	instance := p.ToPollInstance()
	blocks := p.ToBlocks()
	_, timestamp, err := api.PostBlocks(instance.Text, blocks...)
	if err != nil {
		return err
	}
	for _, e := range instance.Emojis {
		if err := api.AddReaction(e, timestamp); err != nil {
			slog.Warn("failed to seed reaction", "emoji", e, "error", err)
		}
	}
	return nil
}

// DeleteLatestPoll finds the most recent poll and deletes it.
func DeleteLatestPoll(api slackclient.API) (string, error) {
	timestamp, _, err := api.FindLatestPoll()
	if err != nil {
		return "", err
	}
	if err := api.DeleteMessage(api.ChannelID(), timestamp); err != nil {
		return "", err
	}
	return "Latest poll deleted.", nil
}

func BuildHelpText() string {
	return strings.Join([]string{
		"Supported slash commands:",
		"/results   - show the current poll results.",
		"/newpoll   - post a new weekly poll.",
		"/runoff    - start a runoff poll when tied.",
		"/notify    - DM voters with their results.",
		"/delete    - delete the most recent poll.",
		"/create    - create a custom poll (coming soon).",
		"/schedule  - show the weekly poll schedule.",
		"/options   - list poll options and emoji.",
		"/vote      - how to vote.",
		"/about     - about this bot.",
		"/ping      - check that the bot is alive.",
		"/help      - show this help text.",
	}, "\n")
}

func BuildOptionsText() string {
	return "Available poll options:\n" + poll.PollOptionsText()
}

func BuildVoteHelpText() string {
	return strings.Join([]string{
		"Vote by reacting to the current poll message with one of the following emojis:",
		poll.PollOptionsText(),
		"Use /results to check the current tally.",
	}, "\n")
}

// buildAdminVoterSummary returns a DM text categorising every voter by the option they chose.
func buildAdminVoterSummary(pollName string, reactions []slackclient.Reaction, botID string, labels map[string]string) string {
	type optionVoters struct {
		emoji  string
		label  string
		voters []string
	}
	var options []optionVoters
	for _, r := range reactions {
		var users []string
		for _, u := range r.Users {
			if u != botID {
				users = append(users, u)
			}
		}
		options = append(options, optionVoters{
			emoji:  r.Name,
			label:  resolveLabel(r.Name, labels),
			voters: users,
		})
	}

	lines := []string{fmt.Sprintf("📊 *Admin Voter Summary: %s*", pollName)}
	for _, opt := range options {
		lines = append(lines, fmt.Sprintf("\n:%s: *%s* (%d vote%s)", opt.emoji, opt.label, len(opt.voters), map[bool]string{true: "", false: "s"}[len(opt.voters) == 1]))
		if len(opt.voters) == 0 {
			lines = append(lines, "  _No votes_")
		}
		for _, uid := range opt.voters {
			lines = append(lines, fmt.Sprintf("  • <@%s>", uid))
		}
	}
	return strings.Join(lines, "\n")
}

// sendAdminDM sends a DM to the user in SLACK_ADMIN_USER_ID, silently skipping if unset.
func sendAdminDM(api slackclient.API, text string) {
	adminID := os.Getenv("SLACK_ADMIN_USER_ID")
	if adminID == "" {
		return
	}
	if err := api.SendDM(adminID, text); err != nil {
		slog.Warn("failed to send admin DM", "error", err)
	}
}

func findWinners(results []pollResult) (int, []string) {
	maxCount := -1
	winning := make([]string, 0)
	for _, result := range results {
		if result.Count > maxCount {
			maxCount = result.Count
			winning = []string{result.Label}
		} else if result.Count == maxCount {
			winning = append(winning, result.Label)
		}
	}
	return maxCount, winning
}

// buildLabelMap returns the emoji→label map for a poll slug.
// Returns nil for the weekly and runoff polls, which use poll.ReactionLabels directly.
func buildLabelMap(slug string) map[string]string {
	if slug == "" || slug == "weekly" || slug == "runoff" {
		return nil
	}
	cp, err := poll.LoadCustomPoll(slug)
	if err != nil {
		slog.Warn("could not load custom poll labels", "slug", slug, "error", err)
		return nil
	}
	return cp.LabelMap()
}

// resolveLabel looks up an emoji name in the custom label map first, then falls back to poll.ReactionLabels.
func resolveLabel(emojiName string, labels map[string]string) string {
	if labels != nil {
		if l, ok := labels[emojiName]; ok {
			return l
		}
	}
	if l, ok := poll.ReactionLabels[emojiName]; ok {
		return l
	}
	return emojiName
}

func tallyResults(reactions []slackclient.Reaction, botID string, labels map[string]string) []pollResult {
	results := make([]pollResult, 0, len(reactions))
	for _, reaction := range reactions {
		count := reaction.Count
		for _, u := range reaction.Users {
			if u == botID {
				count--
				break
			}
		}
		if count < 0 {
			count = 0
		}
		results = append(results, pollResult{
			Name:  reaction.Name,
			Label: resolveLabel(reaction.Name, labels),
			Count: count,
		})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Label < results[j].Label
	})
	return results
}
