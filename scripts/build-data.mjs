import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "data";
const OUT_FILE = path.join(OUT_DIR, "players.json");

const API = "https://api.nhle.com/stats/rest/en";

// IMPORTANT: NHL API often caps at ~500 rows. Using 1000 causes early stop.
const LIMIT = 500;
const GAME_TYPE = 2; // regular season

// ✅ LOCK TO 2024–2025 ONLY (for now)
const SEASONS = ["20242025"];

/* ---------- helpers ---------- */
function n(x){ return Number(x ?? 0) || 0; }
function pick(row, keys){
  for(const k of keys){
    const v = row?.[k];
    if(v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}
function asTeamString(v){
  if(v === null || v === undefined) return "";
  if(Array.isArray(v)) return v.join(", ");
  if(typeof v === "object"){
    return String(v.abbrev ?? v.abbreviation ?? v.teamAbbrev ?? v.teamAbbreviation ?? "").trim();
  }
  return String(v).trim();
}
function mapTeam(anyTeam){
  let t = asTeamString(anyTeam).toUpperCase().trim();
  if(!t) return "";
  if(t.includes(",")){
    // if "SJS, COL" take the last team (most recent in that season record)
    t = t.split(",").map(x => x.trim()).filter(Boolean).pop() || t;
  }
  if(t === "ARI") return "UTAH";
  return t;
}

/* ---------- CBS fantasy scoring (Free) ---------- */
function fantasySkater(row, pos){
  const isD = pos === "D";

  const goals = n(pick(row, ["goals","g"]));
  const assists = n(pick(row, ["assists","a"]));
  const ppg = n(pick(row, ["powerPlayGoals","ppGoals","ppg"]));
  const shg = n(pick(row, ["shortHandedGoals","shGoals","shg"]));
  const plusMinus = n(pick(row, ["plusMinus","plusminus","plus_minus"]));
  const pim = n(pick(row, ["penaltyMinutes","pim"]));

  const goalPts = isD ? 5 : 3;
  const assistPts = isD ? 3 : 2;

  return (
    goals * goalPts +
    assists * assistPts +
    ppg * 1 +
    shg * 2 +
    plusMinus * 1 +
    pim * 0.25
  );
}

function fantasyGoalie(row){
  const wins = n(pick(row, ["wins","w"]));
  const shutouts = n(pick(row, ["shutouts","so"]));
  const saves = n(pick(row, ["saves","s"]));
  const ga = n(pick(row, ["goalsAgainst","ga"]));
  const assists = n(pick(row, ["assists","a"]));
  const pim = n(pick(row, ["penaltyMinutes","pim"]));
  const goals = n(pick(row, ["goals","g"]));

  return (
    wins * 5 +
    shutouts * 3 +
    saves * 0.2 +
    ga * -1 +
    assists * 3 +
    pim * 0.25 +
    goals * 5
  );
}

/* ---------- paging (FIXED) ---------- */
async function fetchPaged(urlBase){
  let start = 0;
  let all = [];
  while(true){
    const url = `${urlBase}&start=${start}&limit=${LIMIT}`;
    const res = await fetch(url);
    if(!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
    const json = await res.json();
    const rows = json?.data || [];
    all = all.concat(rows);

    // If we got a full page, there might be more.
    if(rows.length < LIMIT) break;
    start += LIMIT;
  }
  return all;
}

// Sort by playerId to get stable paging
async function getSkaters(seasonId){
  const cayenne = encodeURIComponent(`gameTypeId=${GAME_TYPE} and seasonId=${seasonId}`);
  const sort = encodeURIComponent(`[{"property":"playerId","direction":"ASC"}]`);
  return fetchPaged(`${API}/skater/summary?isAggregate=false&isGame=false&sort=${sort}&cayenneExp=${cayenne}`);
}

async function getGoalies(seasonId){
  const cayenne = encodeURIComponent(`gameTypeId=${GAME_TYPE} and seasonId=${seasonId}`);
  const sort = encodeURIComponent(`[{"property":"playerId","direction":"ASC"}]`);
  return fetchPaged(`${API}/goalie/summary?isAggregate=false&isGame=false&sort=${sort}&cayenneExp=${cayenne}`);
}

function posFromRow(row, isGoalie){
  if(isGoalie) return "G";
  const raw = String(pick(row, ["positionCode","position","pos"]) ?? "").toUpperCase().trim();
  if(raw === "L") return "LW";
  if(raw === "R") return "RW";
  if(raw === "LD" || raw === "RD") return "D";
  if(["C","LW","RW","D"].includes(raw)) return raw;
  return "C";
}

function playerNameFromRow(row, isGoalie){
  return String(
    pick(row, isGoalie
      ? ["goalieFullName","playerFullName","fullName","playerName","skaterFullName"]
      : ["skaterFullName","playerFullName","fullName","playerName","goalieFullName"]
    ) ?? ""
  ).trim();
}

function teamFromRow(row){
  return mapTeam(pick(row, ["teamAbbrev","teamAbbrevs","teamAbbreviation","team","teamCode"]));
}

/* ---------- main ---------- */
async function main(){
  const players = new Map();

  for(const seasonId of SEASONS){
    const [skaters, goalies] = await Promise.all([getSkaters(seasonId), getGoalies(seasonId)]);

    for(const r of skaters){
      const id = pick(r, ["playerId","playerID","id"]);
      if(!id) continue;

      const name = playerNameFromRow(r,false);
      const team = teamFromRow(r);
      if(!name || !team) continue;

      const pos = posFromRow(r,false);
      const fp = fantasySkater(r,pos);

      players.set(String(id), {
        id: String(id),
        name,
        pos,
        team,
        draftPoints: Math.round(fp * 10) / 10,
        bestSeason: String(seasonId)
      });
    }

    for(const r of goalies){
      const id = pick(r, ["playerId","playerID","id"]);
      if(!id) continue;

      const name = playerNameFromRow(r,true);
      const team = teamFromRow(r);
      if(!name || !team) continue;

      const fp = fantasyGoalie(r);

      players.set(String(id), {
        id: String(id),
        name,
        pos: "G",
        team,
        draftPoints: Math.round(fp * 10) / 10,
        bestSeason: String(seasonId)
      });
    }
  }

  const outPlayers = Array.from(players.values())
    .sort((a,b) => (b.draftPoints - a.draftPoints) || a.name.localeCompare(b.name));

  const meta = {
    generatedAt: new Date().toISOString(),
    seasons: SEASONS,
    count: outPlayers.length,
    scoring: "CBS Sports NHL Fantasy (Free)",
    notes: "Locked to 2024–2025 only. Paging fixed (LIMIT=500) to avoid truncation."
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ meta, players: outPlayers }, null, 2), "utf8");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
