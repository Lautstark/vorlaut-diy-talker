// What this build calls itself.
//
// The greeting now says two things about a device that are easy to confuse.
// CABLE_VERSION is a property of the protocol: it moves when the two ends can
// no longer drive each other, which is rare and deliberate, and it will sit
// still across a dozen releases. This is a property of the build - which
// firmware is on this device - and it moves with every release without the
// protocol moving at all. A page that wants to say "this talker is two
// releases behind" cannot ask the first question and get an answer to the
// second, which is why there is a second word on the wire rather than a
// second meaning for the first.
//
// **Nobody edits this file to cut a release.** The tag is the version, and
// release.yml is the only thing that knows it: it compiles with
//
//   -DVORLAUT_VERSION='"v0.4"'
//
// out of GITHUB_REF_NAME, through the `version` input of
// .github/actions/firmware. A constant kept here instead would be a number
// somebody has to remember to move in the same commit as the tag, and the
// failure when they forget is silent and points the wrong way: the device
// claims a version it is not, and a page that compares against it says
// everything is up to date. A number nobody can forget is worth more than a
// number that reads more nicely in a diff.
//
// So what is left here is the default, and it is deliberately not a number.
// A sketch compiled from the Arduino IDE, from arduino-cli on a desk, or by
// ci-firmware.yml is not a release and has no tag. It says `dev`, which no
// comparison can order against `v0.4` and none should try to: a device that
// says `dev` is one somebody built themselves, possibly from a tree with
// changes in it, and the honest thing for a page to do with it is to name it
// and offer nothing.
//
// One word, no spaces, and short. It goes onto the wire as `< firmware
// <word>` and a second space there would read as a second field. A git tag
// cannot contain a space, so the injected value cannot either.
#pragma once

#ifndef VORLAUT_VERSION
#define VORLAUT_VERSION "dev"
#endif
