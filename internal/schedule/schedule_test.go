package schedule

import (
	"testing"
	"time"
)

func makeTime(weekday time.Weekday, hour int) time.Time {
	// Use a known Monday (2024-01-01 is a Monday)
	base := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	// Advance to target weekday
	offset := (int(weekday) - int(base.Weekday()) + 7) % 7
	d := base.AddDate(0, 0, offset)
	return time.Date(d.Year(), d.Month(), d.Day(), hour, 0, 0, 0, time.UTC)
}

func TestIsDue_Daily(t *testing.T) {
	now := makeTime(time.Monday, 9)
	if !IsDue("daily 09:00", now) {
		t.Error("expected daily 09:00 to be due at 09:xx")
	}
	if IsDue("daily 10:00", now) {
		t.Error("expected daily 10:00 to not be due at 09:xx")
	}
}

func TestIsDue_WeeklySingleDay(t *testing.T) {
	monday9 := makeTime(time.Monday, 9)
	if !IsDue("monday 09:00", monday9) {
		t.Error("expected monday 09:00 to be due on monday at 09:xx")
	}
	if IsDue("tuesday 09:00", monday9) {
		t.Error("expected tuesday 09:00 to not be due on monday")
	}
	if IsDue("monday 10:00", monday9) {
		t.Error("expected monday 10:00 to not be due at 09:xx")
	}
}

func TestIsDue_WeeklyMultiDay(t *testing.T) {
	monday9 := makeTime(time.Monday, 9)
	wednesday9 := makeTime(time.Wednesday, 9)
	friday9 := makeTime(time.Friday, 9)

	schedule := "monday wednesday friday 09:00"

	if !IsDue(schedule, monday9) {
		t.Error("expected multi-day weekly to be due on monday at 09:xx")
	}
	if !IsDue(schedule, wednesday9) {
		t.Error("expected multi-day weekly to be due on wednesday at 09:xx")
	}
	if !IsDue(schedule, friday9) {
		t.Error("expected multi-day weekly to be due on friday at 09:xx")
	}

	tuesday9 := makeTime(time.Tuesday, 9)
	if IsDue(schedule, tuesday9) {
		t.Error("expected multi-day weekly to not be due on tuesday")
	}
}

func TestIsDue_MonthlySingleDay(t *testing.T) {
	// 2024-01-15 is a Monday
	jan15 := time.Date(2024, 1, 15, 9, 0, 0, 0, time.UTC)
	if !IsDue("monthly 15 09:00", jan15) {
		t.Error("expected monthly 15 09:00 to be due on the 15th at 09:xx")
	}
	if IsDue("monthly 15 09:00", time.Date(2024, 1, 14, 9, 0, 0, 0, time.UTC)) {
		t.Error("expected monthly 15 to not be due on the 14th")
	}
	if IsDue("monthly 16 09:00", jan15) {
		t.Error("expected monthly 16 to not be due on the 15th")
	}
}

func TestIsDue_MonthlyMultipleDays(t *testing.T) {
	// The schedule format doesn't support multiple monthly days in one spec,
	// but we test that a single-day monthly spec works at different times.
	jan1 := time.Date(2024, 1, 1, 17, 0, 0, 0, time.UTC)
	if !IsDue("monthly 1 17:00", jan1) {
		t.Error("expected monthly 1 17:00 to be due on jan 1 at 17:xx")
	}
	if IsDue("monthly 1 17:00", time.Date(2024, 1, 1, 16, 0, 0, 0, time.UTC)) {
		t.Error("expected monthly 1 17:00 to not be due at 16:xx")
	}
}

func TestIsDue_InvalidFormats(t *testing.T) {
	now := makeTime(time.Monday, 9)
	tests := []struct {
		schedule string
	}{
		{""},
		{"daily"},
		{"monthly"},
		{"monthly 15"},
		{"notaday 09:00"},
		{"09:00"},
	}
	for _, tt := range tests {
		if IsDue(tt.schedule, now) {
			t.Errorf("expected %q to not be due (invalid format)", tt.schedule)
		}
	}
}
