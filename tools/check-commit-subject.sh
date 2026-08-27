#!/bin/sh
# What a commit subject has to look like, written once.
#
# Two things ask this question and they must not answer it differently:
#
#   .githooks/commit-msg                     one message, as it is written
#   .github/workflows/commit-messages.yml    every commit in a push to main
#
# The hook is a convenience and is opt-in per clone; CI is the gate. Neither
# carries a copy of the rule, because a rule that exists twice gets relaxed
# once and then the two disagree about what landed.
#
#     tools/check-commit-subject.sh "feat: wake in half a second"
#
# Exit 0 = acceptable, or deliberately exempt. Exit 1 = not a conventional
# commit, with the reason on stderr.

subject="$1"

# Things git writes itself, or that carry their own meaning. A merge is not
# a change and has no changelog entry to lose.
case "$subject" in
  "Merge "*|"Revert "*|"fixup! "*|"squash! "*|"Reapply "*) exit 0 ;;
  "#"*|"") exit 0 ;;
esac

# type(optional scope)optional !: subject
pattern='^(feat|fix|perf|refactor|docs|test|build|ci|chore|style|revert)(\([a-z0-9./-]+\))?!?: .+'

if printf '%s' "$subject" | grep -Eq "$pattern"; then
  exit 0
fi

# Unquoted heredoc, because the message has to expand $subject. So the message
# must contain no backticks and no bare $ - either would be substituted, and the
# result is a rejection message with this repository's git log pasted into it.
cat >&2 <<MSG
Not a conventional commit:

  $subject

The prefix says what a commit is before the sentence says what it does, and
it is what makes a one-line log skimmable across three languages. Put it in
front of the sentence you were going to write anyway.

  feat:      a capability that was not there before
  fix:       something that was wrong is now right
  perf:      the same thing, faster
  refactor:  the same behaviour, arranged differently
  docs:      prose
  test, build, ci, chore:  everything else

  feat!: or a "BREAKING CHANGE:" trailer marks a breaking change

A scope is optional and is a path-ish word, not a sentence: fix(cable):,
docs(adr):.

Keep writing the subject the way this repository always has - a sentence that
says what changed, in the present tense. The prefix goes in front of it:

  feat: wake in half a second instead of four and a half
  fix: turn the backlight off when the device sleeps, and mean it

MSG
exit 1
