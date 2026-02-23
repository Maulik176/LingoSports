# Sports Terminology and Locked Terms

These terms should be preserved or translated consistently across locales.

## Locked (keep as-is)

- Team names (`homeTeam`, `awayTeam`)
- Player names (`actor` field)
- Competition identifiers (league names, cup names)

## Preferred Translations

- `kickoff` -> localized equivalent of "kickoff"
- `full time` -> localized equivalent of "full time"
- `free throw` -> localized equivalent of "free throw"
- `wicket` -> localized cricket term, do not replace with football context

## Runtime Policy

The backend translation pipeline applies lock-token replacement for actor/team names before Lingo translation and restores them afterward.
