// Award winners by basketball-reference slug — the answers the Awards tab's
// models (scripts/bake-awards.mjs) and the Look Ahead's MVP model
// (scripts/fit-projection-model.mjs) are fit to.

// nba.com/stats/history/mvp; 2025-26 per ESPN (Shams Charania, May 2026).
export const MVP_WINNERS = {
  "1980-81": "ervinju01", "1981-82": "malonmo01", "1982-83": "malonmo01", "1983-84": "birdla01",
  "1984-85": "birdla01", "1985-86": "birdla01", "1986-87": "johnsma02", "1987-88": "jordami01",
  "1988-89": "johnsma02", "1989-90": "johnsma02", "1990-91": "jordami01", "1991-92": "jordami01",
  "1992-93": "barklch01", "1993-94": "olajuha01", "1994-95": "robinda01", "1995-96": "jordami01",
  "1996-97": "malonka01", "1997-98": "jordami01", "1998-99": "malonka01", "1999-00": "onealsh01",
  "2000-01": "iversal01", "2001-02": "duncati01", "2002-03": "duncati01", "2003-04": "garneke01",
  "2004-05": "nashst01", "2005-06": "nashst01", "2006-07": "nowitdi01", "2007-08": "bryanko01",
  "2008-09": "jamesle01", "2009-10": "jamesle01", "2010-11": "rosede01", "2011-12": "jamesle01",
  "2012-13": "jamesle01", "2013-14": "duranke01", "2014-15": "curryst01", "2015-16": "curryst01",
  "2016-17": "westbru01", "2017-18": "hardeja01", "2018-19": "antetgi01", "2019-20": "antetgi01",
  "2020-21": "jokicni01", "2021-22": "jokicni01", "2022-23": "embiijo01", "2023-24": "jokicni01",
  "2024-25": "gilgesh01", "2025-26": "gilgesh01",
};

// nba.com/news/history-most-improved-player-award-winners (first given 1985-86).
export const MIP_WINNERS = {
  "1985-86": "roberal01", "1986-87": "ellisda01", "1987-88": "duckwke01", "1988-89": "johnske02",
  "1989-90": "seikaro01", "1990-91": "skilesc01", "1991-92": "ellispe01", "1992-93": "abdulma02",
  "1993-94": "macledo01", "1994-95": "barroda01", "1995-96": "muresgh01", "1996-97": "austiis01",
  "1997-98": "hendeal01", "1998-99": "armstda01", "1999-00": "roseja01", "2000-01": "mcgratr01",
  "2001-02": "onealje01", "2002-03": "arenagi01", "2003-04": "randoza01", "2004-05": "simmobo01",
  "2005-06": "diawbo01", "2006-07": "ellismo01", "2007-08": "turkohe01", "2008-09": "grangda01",
  "2009-10": "brookaa01", "2010-11": "loveke01", "2011-12": "anderry01", "2012-13": "georgpa01",
  "2013-14": "dragigo01", "2014-15": "butleji01", "2015-16": "mccolcj01", "2016-17": "antetgi01",
  "2017-18": "oladivi01", "2018-19": "siakapa01", "2019-20": "ingrabr01", "2020-21": "randlju01",
  "2021-22": "moranja01", "2022-23": "markkla01", "2023-24": "maxeyty01", "2024-25": "daniedy01",
  "2025-26": "alexani01",
};

// The 65-game rule (AWARD_MIN_GAMES, lib/projection-model.js) applies from this season on.
export const AWARD_RULE_SINCE = "2023-24";
