// Labels the versions spell differently for the same line.
//
// pokeyellow renamed a handful of pokered's text labels where an NPC changed
// (Cerulean's Cooltrainer talks about her ELECTRODE where Red's talked about a
// SLOWBRO), where two NPCs became one (the Game Corner's second clerk is gone,
// so the first lost his number), or where one became two (Route 22's rival
// lines are numbered). The scripts ported from pokered name pokered's labels.
// When a bundle lacks a label and this table knows Yellow's spelling of it,
// scriptText reads that instead; a bundle that has the original never looks
// here. Anything NOT in this table is a real difference in the scene, not in
// the name, and is ported by hand in MapScripts.SCRIPTS_YELLOW.
//
// Audited on 19 September 2026 by naming every _...Text literal in the
// sources against a Red and a Yellow bundle: 857 labels, 46 missing in Yellow,
// of which these are the renames.

const YELLOW_TEXT_ALIASES: any = {
  // Cerulean City's Cooltrainer, SLOWBRO in Red, ELECTRODE in Yellow.
  _CeruleanCityCooltrainerF1SlowbroWithdrawText: "_CeruleanCityCooltrainerF1ElectrodeWithdrawText",
  _CeruleanCityCooltrainerF1SlowbroUseSonicboomText: "_CeruleanCityCooltrainerF1ElectrodeUseSonicboomText",
  _CeruleanCityCooltrainerF1SlowbroPunchText: "_CeruleanCityCooltrainerF1ElectrodePunchText",
  // The Game Corner's coin clerk: the only one in Yellow, so unnumbered.
  _GameCornerClerk1DoYouNeedSomeGameCoinsText: "_GameCornerClerkDoYouNeedSomeGameCoinsText",
  _GameCornerClerk1ThanksHereAre50CoinsText: "_GameCornerClerkThanksHereAre50CoinsText",
  _GameCornerClerk1PleaseComePlaySometimeText: "_GameCornerClerkPleaseComePlaySometimeText",
  _GameCornerClerk1DontHaveCoinCaseText: "_GameCornerClerkDontHaveCoinCaseText",
  _GameCornerClerk1CoinCaseIsFullText: "_GameCornerClerkCoinCaseIsFullText",
  _GameCornerClerk1CantAffordTheCoinsText: "_GameCornerClerkCantAffordTheCoinsText",
  // The two men who hand out coins: Red's Fishing Guru and Gentleman are
  // Yellow's Fishing Guru 1 and 2.
  _GameCornerFishingGuruWantToPlayText: "_GameCornerFishingGuru1WantToPlayText",
  _GameCornerFishingGuruReceived10CoinsText: "_GameCornerFishingGuru1Received10CoinsText",
  _GameCornerFishingGuruDontNeedMyCoinsText: "_GameCornerFishingGuru1DontNeedMyCoinsText",
  _GameCornerFishingGuruWinsComeAndGoText: "_GameCornerFishingGuru1WinsComeAndGoText",
  _GameCornerGentlemanThrowingMeOffText: "_GameCornerFishingGuru2ThrowingMeOffText",
  _GameCornerGentlemanReceived20CoinsText: "_GameCornerFishingGuru2Received20CoinsText",
  _GameCornerGentlemanYouGotYourOwnCoinsText: "_GameCornerFishingGuru2YouGotYourOwnCoinsText",
  _GameCornerGentlemanCloselyWatchTheReelsText: "_GameCornerFishingGuru2CloselyWatchTheReelsText",
  // Route 22's rival: Yellow numbers the two encounters' lines.
  _Route22RivalBeforeBattleText: "_Route22RivalBeforeBattleText1",
  _Route22RivalAfterBattleText: "_Route22RivalAfterBattleText1",
  // Pallet Town: the line Oak says once you have a Pokemon.
  _PalletTownOakItsUnsafeText: "_PalletTownOakComeWithMe",
  // The Fan Club chairman's darling is a CLEFAIRY in Yellow.
  _PokemonFanClubPikachuText: "_PokemonFanClubClefairyText",
  _PokemonFanClubPikachuFanNormalText: "_PokemonFanClubClefairyFanNormalText",
  _PokemonFanClubPikachuFanBetterText: "_PokemonFanClubClefairyFanBetterText",
};

/**
 * The label a bundle has for a line, when the script names one it lacks.
 * Answers the label itself when the bundle has it or no alias is known.
 */
export function textLabelFor(bundle: any, textId: string): string {
  if (!bundle || !bundle.text || !textId || bundle.text[textId] !== undefined) {
    return textId;
  }
  const alias = YELLOW_TEXT_ALIASES[textId];
  return alias && bundle.text[alias] !== undefined ? alias : textId;
}

/** The whole table, for the audit in the tests. */
export function yellowTextAliases(): any {
  return YELLOW_TEXT_ALIASES;
}
