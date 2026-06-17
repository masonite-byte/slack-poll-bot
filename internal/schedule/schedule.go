package schedule

import (
	"strconv"
	"strings"
	"time"
)

// IsDue returns true if now matches the poll's schedule string.
// Formats:
//   - "weekday HH:MM"             weekly on one day (e.g. "monday 09:00")
//   - "weekday1 weekday2 HH:MM"   weekly on multiple days
//   - "daily HH:MM"               every day at that hour
//   - "monthly DAY HH:MM"         day-of-month (e.g. "monthly 15 09:00")
func IsDue(schedule string, now time.Time) bool {
	parts := strings.Fields(strings.ToLower(schedule))
	if len(parts) < 2 {
		return false
	}

	if parts[0] == "daily" {
		return matchesHour(parts[1], now)
	}

	if parts[0] == "monthly" {
		if len(parts) < 3 {
			return false
		}
		day, err := strconv.Atoi(parts[1])
		return err == nil && now.Day() == day && matchesHour(parts[2], now)
	}

	// Weekly: one or more weekday names followed by HH:MM
	weekdays := map[string]time.Weekday{
		"sunday": time.Sunday, "monday": time.Monday, "tuesday": time.Tuesday,
		"wednesday": time.Wednesday, "thursday": time.Thursday,
		"friday": time.Friday, "saturday": time.Saturday,
	}
	timeIdx := -1
	for i, p := range parts {
		if strings.Contains(p, ":") {
			timeIdx = i
			break
		}
	}
	if timeIdx < 0 {
		return false
	}
	for _, dayStr := range parts[:timeIdx] {
		if wd, ok := weekdays[dayStr]; ok && now.Weekday() == wd {
			return matchesHour(parts[timeIdx], now)
		}
	}
	return false
}

func matchesHour(timeStr string, now time.Time) bool {
	hm := strings.SplitN(timeStr, ":", 2)
	if len(hm) != 2 {
		return false
	}
	hour, err := strconv.Atoi(hm[0])
	return err == nil && now.Hour() == hour
}
