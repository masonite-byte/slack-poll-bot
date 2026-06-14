package slackclient

import "testing"

func TestContainsPollHeader(t *testing.T) {
    cases := []struct{
        in string
        want bool
    }{
        {"📊 *Weekly Poll*\nWhat should we do?", true},
        {"Random message", false},
        {"📊 *Weekly Poll* - extra", true},
        {"📊 Weekly Poll", false},
    }

    for _, c := range cases {
        got := containsPollHeader(c.in)
        if got != c.want {
            t.Fatalf("containsPollHeader(%q) = %v; want %v", c.in, got, c.want)
        }
    }
}
