import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "data";
const OUT_FILE = path.join(OUT_DIR, "players.json");

const API = "https://api.nhle.com/stats/rest/en";
const LIMIT = 1000;
const GAME_TYPE = 2; // regular season

const SEASONS_BACK = 7;

// Fantasy points (simple default; can be expanded later)
function fantasySkater(row){
  return Number(row.points ?? 0) || 0;
}
function fantasyGoalie(row){
  const wins = Number(row.wins ?? 0) || 0;
  const shutouts = Number(row.shutouts ?? 0) || 0;
  const saves = Number(row.saves ?? 0) || 0;
  const ga = Number(row.goalsAgainst ?? 0) || 0;
  return (2*wins) + (3*shutouts) + (0.1*saves) - (1*ga);
}

// If API returns "SJS, COL" take LAST team; ARI maps to UTAH
function mapTeam(abbrev){
  let t = String(abbrev || "").toUpperCase().trim();
  if(!t) return "";
  if(t.includes(",")){
    t = t.split(",").map(x => x.trim()).filter(Boolean).pop() || t;
  }
  if(t === "ARI") return "UTAH";
  return t;
}

function lastCompletedSeasonEndYear(now = new Date()){
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return (m >= 7) ? y : (y - 1);
}
function seasonIdFromEndYear(endYear){
  const startYear = endYear - 1;
  return Number(`${startYear}${endYear}`);
}
function lastNSeasons(n){
  const end = lastCompletedSeasonEndYear();
  const seasons = [];
  for(let i=0;i<n;i++){
    seasons.push(seasonIdFromEndYear(end - i));
  }
  return seasons;
}

async function fetchPaged(urlBase){
  let start = 0;
  let all = [];
  while(true){
    const url = `${urlBase}&start=${start}&limit=${LIMIT}`;
    const res = await fetch(url);
    if(!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
    const json = await res.json();
    const rows = json?.data || [];
    all = all.concat(rows);
    if(rows.length < LIMIT) break;
    start += LIMIT;
  }
  return all;
}

async function getSkaterRows(seasonId){
  const cayenne = encodeURIComponent(`gameTypeId=${GAME_TYPE} and seasonId=${seasonId}`);
  const sort = encodeURIComponent(`[{"property":"points","direction":"DESC"}]`);
  const urlBase = `${API}/skater/summary?isAggregate=false&isGame=false&sort=${sort}&cayenneExp=${cayenne}`;
  return fetchPaged(urlBase);
}

async function getGoalieRows(seasonId){
  const cayenne = encodeURIComponent(`gameTypeId=${GAME_TYPE} and seasonId=${seasonId}`);
  const sort = encodeURIComponent(`[{"property":"wins","direction":"DESC"}]`);
  const urlBase = `${API}/goalie/summary?isAggregate=false&isGame=false&sort=${sort}&cayenneExp=${cayenne}`;
  return fetchPaged(urlBase);
}

function posFromRow(row, isGoalie){
  if(isGoalie) return "G";
  const p = String(row.positionCode || "").toUpperCase().trim();
  if(p === "L") return "LW";
  if(p === "R") return "RW";
  if(p === "C" || p === "LW" || p === "RW" || p === "D") return p;
  if(p === "LD" || p === "RD") return "D";
  if(p === "F") return "C";
  return p || "C";
}

function pickBestSeason(seasons){
  let best = null;
  for(const s of seasons){
    if(!best || s.fantasyPoints > best.fantasyPoints) best = s;
  }
  return best;
}

function pickMostRecentSeason(seasons){
  let recent = null;
  for(const s of seasons){
    if(!recent || s.seasonId > recent.seasonId) recent = s;
  }
  return recent;
}

async function main(){
  const seasons = lastNSeasons(SEASONS_BACK);
  const players = new Map();

  for(const seasonId of seasons){
    console.log(`Season ${seasonId}…`);
    const [skaters, goalies] = await Promise.all([
      getSkaterRows(seasonId),
      getGoalieRows(seasonId)
    ]);

    for(const r of skaters){
      const id = r.playerId ?? r.playerId2 ?? r.playerId3 ?? r.playerId4 ?? r.playerId5;
      if(!id) continue;

      const name = r.skaterFullName || r.playerFullName || r.playerName || r.fullName;
      const team = mapTeam(r.teamAbbrev || r.teamAbbrevs || r.teamAbbreviation || r.team);
      if(!name || !team) continue;

      const fp = fantasySkater(r);
      const pos = posFromRow(r, false);

      const cur = players.get(String(id)) || { id: String(id), name, pos, seasons: [] };
      cur.name = cur.name || name;
      cur.pos = cur.pos || pos;

      cur.seasons.push({ seasonId, team, fantasyPoints: fp });
      players.set(String(id), cur);
    }

    for(const r of goalies){
      const id = r.playerId;
      if(!id) continue;

      const name = r.goalieFullName || r.playerFullName || r.playerName || r.fullName;
      const team = mapTeam(r.teamAbbrev || r.teamAbbrevs || r.teamAbbreviation || r.team);
      if(!name || !team) continue;

      const fp = fantasyGoalie(r);

      const cur = players.get(String(id)) || { id: String(id), name, pos: "G", seasons: [] };
      cur.name = cur.name || name;
      cur.pos = "G";

      cur.seasons.push({ seasonId, team, fantasyPoints: fp });
      players.set(String(id), cur);
    }
  }

  const outPlayers = [];
  for(const p of players.values()){
    if(!p.seasons?.length) continue;

    const best = pickBestSeason(p.seasons);
    const recent = pickMostRecentSeason(p.seasons);
    if(!best || !recent) continue;

    outPlayers.push({
      id: p.id,
      name: p.name,
      pos: p.pos,
      team: recent.team, // most recent team in window
      draftPoints: Math.round(best.fantasyPoints * 10) / 10,
      bestSeason: String(best.seasonId)
    });
  }

  outPlayers.sort((a,b) => (b.draftPoints - a.draftPoints) || a.name.localeCompare(b.name));

  const meta = {
    generatedAt: new Date().toISOString(),
    seasons: seasons.map(String),
    count: outPlayers.length,
    notes: "draftPoints = best season fantasyPoints within last 7 completed seasons; team = most recent team within window; ARI mapped to UTAH; multi-team strings use last team."
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ meta, players: outPlayers }, null, 2), "utf8");
  console.log(`Wrote ${OUT_FILE} with ${outPlayers.length} players.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
