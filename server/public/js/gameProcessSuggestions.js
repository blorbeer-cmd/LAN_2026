// Best-effort lookup of common LAN-party games -> their known Windows
// process names, so adding a game doesn't require starting it first just to
// read the .exe name off Task Manager. Matched by loose substring against
// the typed game name. Not exhaustive and exe names can change with game
// updates/store fronts (Steam vs. Epic vs. Battle.net) — always shown as an
// editable suggestion, never a silent guarantee.

const SUGGESTIONS = [
  { keywords: ['counter-strike 2', 'counter strike 2', 'cs2'], processNames: ['cs2.exe'] },
  { keywords: ['counter-strike: global offensive', 'counter strike global offensive', 'csgo', 'cs:go'], processNames: ['csgo.exe'] },
  { keywords: ['valorant'], processNames: ['VALORANT-Win64-Shipping.exe', 'VALORANT.exe'] },
  { keywords: ['league of legends', 'lol'], processNames: ['League of Legends.exe', 'LeagueClientUx.exe'] },
  { keywords: ['dota 2', 'dota2'], processNames: ['dota2.exe'] },
  { keywords: ['rocket league'], processNames: ['RocketLeague.exe'] },
  { keywords: ['overwatch'], processNames: ['Overwatch.exe'] },
  { keywords: ['apex legends', 'apex'], processNames: ['r5apex.exe'] },
  { keywords: ['fortnite'], processNames: ['FortniteClient-Win64-Shipping.exe'] },
  { keywords: ['rainbow six siege', 'r6 siege', 'siege'], processNames: ['RainbowSix.exe', 'RainbowSix_BE.exe'] },
  { keywords: ['call of duty: warzone', 'warzone', 'call of duty'], processNames: ['cod.exe'] },
  { keywords: ['grand theft auto v', 'gta v', 'gta 5'], processNames: ['GTA5.exe'] },
  { keywords: ['minecraft'], processNames: ['javaw.exe'] },
  { keywords: ['age of empires ii', 'age of empires 2', 'aoe2'], processNames: ['AoE2DE_s.exe'] },
  { keywords: ['age of empires iv', 'age of empires 4', 'aoe4'], processNames: ['RelicCardinal.exe'] },
  { keywords: ['left 4 dead 2', 'l4d2'], processNames: ['left4dead2.exe'] },
  { keywords: ['team fortress 2', 'tf2'], processNames: ['tf_win64.exe'] },
  { keywords: ['among us'], processNames: ['Among Us.exe'] },
  { keywords: ['fall guys'], processNames: ['FallGuys_client_game.exe'] },
  { keywords: ['it takes two'], processNames: ['ItTakesTwo.exe'] },
  { keywords: ['human: fall flat', 'human fall flat'], processNames: ['Human_Fall_Flat.exe'] },
  { keywords: ['deep rock galactic', 'drg'], processNames: ['FSD-Win64-Shipping.exe'] },
  { keywords: ['valheim'], processNames: ['valheim.exe'] },
  { keywords: ['satisfactory'], processNames: ['FactoryGame-Win64-Shipping.exe'] },
  { keywords: ['terraria'], processNames: ['Terraria.exe'] },
  { keywords: ['stardew valley'], processNames: ['Stardew Valley.exe'] },
  { keywords: ['golf with your friends'], processNames: ['GolfWithYourFriends.exe'] },
  { keywords: ['lethal company'], processNames: ['Lethal Company.exe'] },
  { keywords: ['chivalry 2', 'chivalry ii'], processNames: ['Chivalry2-Win64-Shipping.exe'] },
  { keywords: ['for honor'], processNames: ['ForHonor.exe'] },
  { keywords: ['brawlhalla'], processNames: ['Brawlhalla.exe'] },
  { keywords: ['tekken 8'], processNames: ['TEKKEN8.exe'] },
  { keywords: ['street fighter 6'], processNames: ['StreetFighter6.exe'] },
  { keywords: ['world of warcraft', 'wow'], processNames: ['Wow.exe'] },
  { keywords: ['diablo iv', 'diablo 4'], processNames: ['Diablo IV.exe'] },
  { keywords: ['starcraft ii', 'starcraft 2', 'sc2'], processNames: ['SC2_x64.exe'] },
  { keywords: ['warcraft iii', 'warcraft 3'], processNames: ['Warcraft III.exe'] },
  { keywords: ['heroes of the storm'], processNames: ['HeroesOfTheStorm_x64.exe'] },
  { keywords: ['payday 2'], processNames: ['payday2_win32_release.exe'] },
  { keywords: ['payday 3'], processNames: ['payday3.exe'] },
  { keywords: ['risk of rain 2'], processNames: ['Risk of Rain 2.exe'] },
  { keywords: ['dead by daylight'], processNames: ['DeadByDaylight-Win64-Shipping.exe'] },
  { keywords: ['phasmophobia'], processNames: ['Phasmophobia.exe'] },
  { keywords: ["garry's mod", 'garrys mod', 'gmod'], processNames: ['hl2.exe'] },
  { keywords: ['squad'], processNames: ['SquadGame.exe'] },
  { keywords: ['battlefield 2042', 'battlefield'], processNames: ['bf2042.exe'] },
  { keywords: ['pubg', 'playerunknown'], processNames: ['TslGame.exe'] },
  { keywords: ['osu!', 'osu'], processNames: ['osu!.exe'] },
  { keywords: ['trackmania'], processNames: ['Trackmania.exe'] },
  { keywords: ['forza horizon 5', 'forza horizon'], processNames: ['ForzaHorizon5.exe'] },
  { keywords: ['stumble guys'], processNames: ['StumbleGuys.exe'] },
  { keywords: ['unrailed'], processNames: ['Unrailed.exe'] },
  { keywords: ['overcooked'], processNames: ['Overcooked2.exe'] },
  { keywords: ['party animals'], processNames: ['PartyAnimals.exe'] },
];

// Returns known process names for a typed game name, or [] if nothing
// matches. Loose match in both directions so "CS2" matches "counter-strike
// 2" and "Counter-Strike 2 (Premier)" still matches "cs2".
export function suggestProcessNames(gameName) {
  const normalized = (gameName || '').trim().toLowerCase();
  if (normalized.length < 3) return [];
  for (const entry of SUGGESTIONS) {
    if (entry.keywords.some((k) => normalized.includes(k) || k.includes(normalized))) {
      return entry.processNames;
    }
  }
  return [];
}
