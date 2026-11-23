"""Generate targets/nba_standings/data/sample_season.json deterministically and print
the expected standings (independent Python implementation used to write hidden tests)."""
import json, random, math
from collections import defaultdict
from pathlib import Path

TEAMS = [  # abbr, name, conference, division
 ("BOS","Boston Celtics","East","Atlantic"),("BKN","Brooklyn Nets","East","Atlantic"),("NYK","New York Knicks","East","Atlantic"),
 ("PHI","Philadelphia 76ers","East","Atlantic"),("TOR","Toronto Raptors","East","Atlantic"),
 ("CHI","Chicago Bulls","East","Central"),("CLE","Cleveland Cavaliers","East","Central"),("DET","Detroit Pistons","East","Central"),
 ("IND","Indiana Pacers","East","Central"),("MIL","Milwaukee Bucks","East","Central"),
 ("ATL","Atlanta Hawks","East","Southeast"),("CHA","Charlotte Hornets","East","Southeast"),("MIA","Miami Heat","East","Southeast"),
 ("ORL","Orlando Magic","East","Southeast"),("WAS","Washington Wizards","East","Southeast"),
 ("DEN","Denver Nuggets","West","Northwest"),("MIN","Minnesota Timberwolves","West","Northwest"),("OKC","Oklahoma City Thunder","West","Northwest"),
 ("POR","Portland Trail Blazers","West","Northwest"),("UTA","Utah Jazz","West","Northwest"),
 ("GSW","Golden State Warriors","West","Pacific"),("LAC","LA Clippers","West","Pacific"),("LAL","Los Angeles Lakers","West","Pacific"),
 ("PHX","Phoenix Suns","West","Pacific"),("SAC","Sacramento Kings","West","Pacific"),
 ("DAL","Dallas Mavericks","West","Southwest"),("HOU","Houston Rockets","West","Southwest"),("MEM","Memphis Grizzlies","West","Southwest"),
 ("NOP","New Orleans Pelicans","West","Southwest"),("SAS","San Antonio Spurs","West","Southwest"),
]
FIRST = ["Jalen","Marcus","Devin","Tyrese","Jordan","Malik","Cade","Trey","Darius","Kyle","Andre","Isaiah","Zion","Luka","Nico","Jaylen","Evan","Grant","Cam","Josh"]
LAST = ["Carter","Reed","Hayes","Bennett","Morgan","Foster","Price","Hughes","Ward","Cole","Brooks","Gray","Perry","Rivera","Hart","Lane","Stone","Webb","Bishop","Dean"]
POS = ["PG","SG","SF","PF","C"]

rng = random.Random(2026)
strength = {t[0]: rng.uniform(0.35, 0.65) for t in TEAMS}

players, pid = [], 1
for abbr, *_ in TEAMS:
    used = set()
    for k in range(3):
        while True:
            name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
            if name not in used: used.add(name); break
        players.append({"id": pid, "name": name, "teamId": abbr, "position": POS[(k*2) % 5], "number": rng.randint(0, 45),
                        "injury": {"status": "healthy", "note": "", "expectedReturn": None}})
        pid += 1
# a few injuries in the sample
players[4]["injury"] = {"status": "out", "note": "Sprained ankle", "expectedReturn": "2026-12-15"}
players[31]["injury"] = {"status": "day-to-day", "note": "Knee soreness", "expectedReturn": None}
players[70]["injury"] = {"status": "out", "note": "Hamstring strain", "expectedReturn": "2027-01-05"}

games, gid = [], 1
abbrs = [t[0] for t in TEAMS]
days = [f"2026-11-{d:02d}" for d in range(1, 29)]
played = {a: 0 for a in abbrs}
for day in days:
    pool = abbrs[:]; rng.shuffle(pool)
    pool.sort(key=lambda a: played[a])    # teams with fewest games play first -> balanced schedule
    order = pool[:10]; rng.shuffle(order)
    for a in order: played[a] += 1
    for i in range(0, 10, 2):              # 5 games per day -> 140 games
        home, away = order[i], order[i+1]
        p_home = 0.5 + (strength[home] - strength[away]) + 0.05
        home_wins = rng.random() < p_home
        hs = rng.randint(100, 128); as_ = rng.randint(96, 124)
        if home_wins and hs <= as_: hs = as_ + rng.randint(1, 9)
        if not home_wins and as_ <= hs: as_ = hs + rng.randint(1, 9)
        games.append({"id": gid, "date": day, "homeTeam": home, "awayTeam": away, "homeScore": hs, "awayScore": as_})
        gid += 1

by_team = defaultdict(list)
for p in players: by_team[p["teamId"]].append(p)
stats = []
for g in games:
    for side in ("homeTeam", "awayTeam"):
        for p in by_team[g[side]]:
            if p["injury"]["status"] == "out": continue
            stats.append({"gameId": g["id"], "playerId": p["id"], "points": rng.randint(4, 34),
                          "rebounds": rng.randint(1, 13), "assists": rng.randint(0, 11)})

data = {"teams": [dict(zip(("id","name","conference","division"), t)) for t in TEAMS],
        "players": players, "games": games, "stats": stats}
out = Path(__file__).resolve().parents[2] / "targets" / "nba_standings" / "data" / "sample_season.json"
out.write_text(json.dumps(data, indent=1))
print(f"wrote {out.name}: {len(games)} games, {len(players)} players, {len(stats)} stat lines")

# ---------------- expected standings (independent implementation) ----------------
rec = {a: {"w":0,"l":0,"hw":0,"hl":0,"aw":0,"al":0,"pf":0,"pa":0,"results":[]} for a in abbrs}
for g in sorted(games, key=lambda g: (g["date"], g["id"])):
    hw = g["homeScore"] > g["awayScore"]
    h, a = rec[g["homeTeam"]], rec[g["awayTeam"]]
    h["pf"] += g["homeScore"]; h["pa"] += g["awayScore"]; a["pf"] += g["awayScore"]; a["pa"] += g["homeScore"]
    if hw: h["w"]+=1; h["hw"]+=1; a["l"]+=1; a["al"]+=1; h["results"].append("W"); a["results"].append("L")
    else:  a["w"]+=1; a["aw"]+=1; h["l"]+=1; h["hl"]+=1; a["results"].append("W"); h["results"].append("L")

def streak(res):
    if not res: return "-"
    c = res[-1]; n = 0
    for r in reversed(res):
        if r == c: n += 1
        else: break
    return f"{c}{n}"

rows = []
for a in abbrs:
    r = rec[a]; gp = r["w"]+r["l"]
    rows.append({"team": a, "conf": next(t[2] for t in TEAMS if t[0]==a), "w": r["w"], "l": r["l"],
                 "pct": round(r["w"]/gp, 3) if gp else 0.0, "diff": r["pf"]-r["pa"],
                 "home": f'{r["hw"]}-{r["hl"]}', "away": f'{r["aw"]}-{r["al"]}',
                 "last10": f'{r["results"][-10:].count("W")}-{r["results"][-10:].count("L")}', "streak": streak(r["results"])})
for conf in ("East","West"):
    cr = sorted([x for x in rows if x["conf"]==conf], key=lambda x: (-x["pct"], -x["diff"], x["team"]))
    lead = cr[0]
    print(f"\n{conf}")
    for i, x in enumerate(cr, 1):
        gb = ((lead["w"]-x["w"]) + (x["l"]-lead["l"]))/2
        zone = "playoff" if i<=6 else "play-in" if i<=10 else "out"
        print(f'{i:2} {x["team"]} {x["w"]}-{x["l"]} pct={x["pct"]:.3f} gb={gb:.1f} diff={x["diff"]:+} home={x["home"]} away={x["away"]} l10={x["last10"]} stk={x["streak"]} {zone}')

# player averages for a couple of players
agg = defaultdict(lambda: [0,0,0,0])
for s in stats:
    a = agg[s["playerId"]]; a[0]+=1; a[1]+=s["points"]; a[2]+=s["rebounds"]; a[3]+=s["assists"]
print()
for p in (1, 2, 5, 32, 71, 90):
    a = agg[p]; pl = players[p-1]
    print(p, pl["name"], pl["teamId"], pl["position"], pl["injury"]["status"], "gp", a[0],
          "ppg", round(a[1]/a[0],1) if a[0] else 0, "rpg", round(a[2]/a[0],1) if a[0] else 0, "apg", round(a[3]/a[0],1) if a[0] else 0)
top = sorted(((round(a[1]/a[0],1), p) for p, a in agg.items() if a[0]), reverse=True)[:3]
print("top ppg", [(players[p-1]["name"], v) for v, p in top])
