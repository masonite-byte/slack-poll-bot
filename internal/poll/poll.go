package poll

import "fmt"

// WeeklyPoll returns the raw text formatting for the weekly poll question
func WeeklyPoll() string {
    return fmt.Sprintf(
        "📊 *Weekly Poll*\n\nWhat should we do this week?\n\n👍 Option A\n🎉 Option B\n🚀 Option C\n",
    )
}
