// Stable integer game-mode IDs. Labels and speed rules are presentation/configuration,
 // never values stored in the database or saved game snapshots.
const GAME_MODES=Object.freeze({
  0:Object.freeze({label:"Beginner",startingLevel:0,progressive:false,description:"0.80s per row. Never speeds up."}),
  1:Object.freeze({label:"Easy",startingLevel:0,progressive:true,description:"Starts at 0.80s per row. Faster every 10 lines."}),
  2:Object.freeze({label:"Hard",startingLevel:5,progressive:true,description:"Starts at 0.38s per row. Faster every 10 lines."})
});
const GAME_MODE_IDS=Object.freeze(Object.keys(GAME_MODES).map(Number));
const DEFAULT_GAME_MODE=1; // Preserve the previous default of Easy.
const LEGACY_GAME_MODE_IDS=Object.freeze({fixed:0,beginner:0,easy:1,hard:2});

// Accept old string saves/preferences only when reading them. Write integer IDs.
function parseGameMode(value){
  if(Number.isInteger(value)&&Object.hasOwn(GAME_MODES,value))return value;
  if(typeof value==="string"){
    if(Object.hasOwn(LEGACY_GAME_MODE_IDS,value))return LEGACY_GAME_MODE_IDS[value];
    if(/^[0-2]$/.test(value))return Number(value);
  }
  return null;
}
