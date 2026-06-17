package main

import (
	"os"
	"testing"
	"time"
)

// chicagoTime builds a time.Time in America/Chicago for test cases.
func chicagoTime(t *testing.T, year int, month time.Month, day, hour, min int) time.Time {
	t.Helper()
	tz, err := time.LoadLocation("America/Chicago")
	if err != nil {
		t.Fatalf("failed to load timezone: %v", err)
	}
	return time.Date(year, month, day, hour, min, 0, 0, tz)
}

// June 15 2026 is a Monday.
func TestIsDueMatchingDayAndHour(t *testing.T) {
	now := chicagoTime(t, 2026, time.June, 15, 9, 0) // Monday 9 AM CT
	if !isDue("monday 09:00", now) {
		t.Fatal("expected isDue=true for matching day and hour")
	}
}

func TestIsDueWrongDay(t *testing.T) {
	now := chicagoTime(t, 2026, time.June, 16, 9, 0) // Tuesday 9 AM CT
	if isDue("monday 09:00", now) {
		t.Fatal("expected isDue=false when weekday does not match")
	}
}

func TestIsDueWrongHour(t *testing.T) {
	now := chicagoTime(t, 2026, time.June, 15, 10, 0) // Monday 10 AM CT
	if isDue("monday 09:00", now) {
		t.Fatal("expected isDue=false when hour does not match")
	}
}

func TestIsDueCaseInsensitive(t *testing.T) {
	now := chicagoTime(t, 2026, time.June, 15, 9, 0) // Monday 9 AM CT
	if !isDue("MONDAY 09:00", now) {
		t.Fatal("expected isDue=true for uppercase weekday")
	}
	if !isDue("Monday 09:00", now) {
		t.Fatal("expected isDue=true for title-case weekday")
	}
}

func TestIsDueStripsTrailingTimezone(t *testing.T) {
	now := chicagoTime(t, 2026, time.June, 15, 9, 0)
	if !isDue("monday 09:00 CT", now) {
		t.Fatal("expected isDue=true when CT suffix is present")
	}
	if !isDue("monday 09:00 CST", now) {
		t.Fatal("expected isDue=true when CST suffix is present")
	}
}

func TestIsDueFridayAfternoon(t *testing.T) {
	// June 19 2026 is a Friday.
	now := chicagoTime(t, 2026, time.June, 19, 17, 0)
	if !isDue("friday 17:00", now) {
		t.Fatal("expected isDue=true for friday 17:00")
	}
}

func TestIsDueEmptyScheduleReturnsFalse(t *testing.T) {
	now := chicagoTime(t, 2026, time.June, 15, 9, 0)
	if isDue("", now) {
		t.Fatal("expected isDue=false for empty schedule")
	}
}

func TestIsDueInvalidFormatReturnsFalse(t *testing.T) {
	now := chicagoTime(t, 2026, time.June, 15, 9, 0)
	cases := []string{
		"monday",          // no time
		"monday09:00",     // missing space
		"monday 9",        // no colon
		"notaday 09:00",   // unknown weekday
	}
	for _, s := range cases {
		if isDue(s, now) {
			t.Fatalf("expected isDue=false for invalid schedule %q", s)
		}
	}
}

// ── State file round-trip ─────────────────────────────────────────────────────

func TestLoadStateReturnEmptyMapWhenMissing(t *testing.T) {
	// Point stateFile at a non-existent path.
	orig := stateFile
	stateFile = t.TempDir() + "/no-such-file.json"
	t.Cleanup(func() { stateFile = orig })

	m := loadState()
	if len(m) != 0 {
		t.Fatalf("expected empty map for missing state file, got %v", m)
	}
}

func TestSaveAndLoadStateRoundtrip(t *testing.T) {
	dir := t.TempDir()
	orig := stateFile
	stateFile = dir + "/state.json"
	t.Cleanup(func() { stateFile = orig })

	want := map[string]string{
		"summer-sports": "2026-06-15",
		"friday-fun":    "2026-06-19",
	}
	if err := saveState(want); err != nil {
		t.Fatalf("saveState error: %v", err)
	}

	got := loadState()
	if len(got) != len(want) {
		t.Fatalf("expected %d entries, got %d", len(want), len(got))
	}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("key %q: expected %q, got %q", k, v, got[k])
		}
	}
}

func TestLoadStateReturnsEmptyMapForInvalidJSON(t *testing.T) {
	dir := t.TempDir()
	orig := stateFile
	stateFile = dir + "/state.json"
	t.Cleanup(func() { stateFile = orig })

	if err := os.WriteFile(stateFile, []byte("{not valid"), 0644); err != nil {
		t.Fatalf("failed to write bad JSON: %v", err)
	}
	m := loadState()
	if len(m) != 0 {
		t.Fatalf("expected empty map for invalid JSON, got %v", m)
	}
}
