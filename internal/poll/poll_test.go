package poll

import (
    "strings"
    "testing"
)

func TestWeeklyPollContainsHeaderAndOptions(t *testing.T) {
    s := WeeklyPoll()
    if !strings.HasPrefix(s, "📊 *Weekly Poll*") {
        t.Fatalf("WeeklyPoll() missing header; got: %q", s)
    }
    if !strings.Contains(s, "Option A") || !strings.Contains(s, "Option B") || !strings.Contains(s, "Option C") {
        t.Fatalf("WeeklyPoll() missing expected options; got: %q", s)
    }
}
