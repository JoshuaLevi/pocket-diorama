# Round 2 scenarios (6 sep 2026)

Written by the second playtest workflow (Pallet Town, BLUE's house, the lab,
the three starters, the rival trigger). Nine representative ones moved up
into the gate; the rest stay here and run on demand:

    for f in tools/oracle/scenarios/round2/*.json; do
      node --experimental-strip-types --import ./test/register.mjs \
        tools/oracle/compare.mjs "<ROM>" Assets/Generated/kanto.json "$f" | grep COMPARE; done

Fourteen of them differed for the same two reasons, neither a rule of the
game the lens gets wrong (see FINDINGS.md, 6 sep):
- presses fired faster than the cartridge prints a page: the ROM ignores a
  button while text is still printing, the lens's pages were instant, so the
  two machines ended up a page apart (starter-squirtle-*, starter-bulbasaur-*).
  Fixed (fix-round-2): the lens now waits out the option's own print speed
  before honouring a button. All twenty starter-*/lab-tour-* scenarios here
  read 0 differ against the ROM again (checked 6 sep); the two most direct
  reproductions moved up into the gate (starter-squirtle-1-yes-party.json,
  starter-bulbasaur-1-basic-select-no-nickname.json).
- the starter's Pokedex page, which the lens does not show yet -- still
  open. Three scenarios still differ on it alone (lab-tour-6-choose-starter,
  lab-tour-7-no-movement, rival-trigger-1-charmander-door): each `talk`
  reaches the party a page early because the lens has no Pokedex screen to
  press through first, so the ROM (still on that page) reports an empty
  party where the lens already reports the starter.
