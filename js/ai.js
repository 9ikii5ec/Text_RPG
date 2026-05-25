class Action {
  constructor(description, callback) {
    this.description = description;
    this._scores = [];
    this._condition = () => true;
    callback(this);
  }
  condition(callback) { this._condition = callback; }
  score(description, callback) { this._scores.push({ description, callback }); }
  evaluate(data) {
    if (!this._condition(data)) return -Infinity;
    return this._scores.reduce((acc, s) => acc + s.callback(data), 0);
  }
}

class UtilityAi {
  constructor() { this._actions = []; }
  addAction(description, callback) {
    const a = new Action(description, callback);
    this._actions.push(a);
  }
  evaluate(data) {
    return this._actions
      .map(a => ({ action: a.description, score: a.evaluate(data) }))
      .reduce((best, cur) => (best.score === undefined || best.score === null || cur.score > best.score ? cur : best), {});
  }
}

const AI_PROFILES = {};

function buildAiProfile_boneHunter() {
  const ai = new UtilityAi();
  ai.addAction("attack", (a) => {
    a.score("is_not_hunter", (d) => d.playerFate === "bone_hunter" ? -Infinity : 20);
    a.score("is_night", (d) => d.isNight ? 50 : 0);
    a.score("player_low_hp", (d) => d.playerHp < d.playerMaxHp * 0.5 ? 30 : 0);
    a.score("bad_rep", (d) => d.playerRep < 0 ? 40 : 0);
    a.score("outnumbered", (d) => d.hunterCount > d.threatCount ? 20 : 0);
    a.score("sealed_blade", (d) => d.hasSealedBlade ? 25 : 0);
  });
  ai.addAction("ambush", (a) => {
    a.condition((d) => d.playerFate !== "bone_hunter" && !d.alreadyAmbushed);
    a.score("is_night", (d) => d.isNight ? 60 : 0);
    a.score("in_desert", (d) => d.inDesert ? 40 : 0);
    a.score("just_arrived", (d) => d.justArrived ? 30 : 0);
  });
  ai.addAction("demand_toll", (a) => {
    a.condition((d) => d.playerFate !== "bone_hunter" && d.hasItems);
    a.score("neutral_rep", (d) => d.playerRep >= 0 ? 40 : 0);
    a.score("daytime", (d) => !d.isNight ? 30 : 0);
    a.score("healthy", (d) => d.playerHp > d.playerMaxHp * 0.5 ? 20 : 0);
  });
  ai.addAction("ignore", (a) => {
    a.score("same_faction", (d) => d.playerFate === "bone_hunter" ? 100 : 0);
    a.score("high_rep", (d) => d.playerRep >= 3 ? 40 : 0);
    a.score("has_token", (d) => d.hasBoneToken ? 20 : 0);
    a.score("daytime", (d) => !d.isNight ? 15 : 0);
  });
  ai.addAction("flee", (a) => {
    a.condition((d) => d.hunterHp !== undefined && d.hunterHp <= (d.hunterMaxHp || 1) * 0.3);
    a.score("near_death", (d) => d.hunterHp < (d.hunterMaxHp || 1) * 0.15 ? 70 : 0);
    a.score("night_penalty", (d) => d.isNight ? -30 : 0);
    a.score("blade_bravery", (d) => d.hasSealedBlade ? -20 : 0);
  });
  return ai;
}

function buildAiProfile_demonBlade() {
  const ai = new UtilityAi();
  ai.addAction("attack_weakest", (a) => {
    a.condition((d) => d.bloodThirst >= 7 && d.targets && d.targets.length);
    a.score("finish_target", (d) => {
      const m = Math.min(...d.targets.map(t => t.state.hp !== null && t.state.hp !== undefined ? t.state.hp : 999));
      return m <= 10 ? 50 : 0;
    });
    a.score("wounded_exist", (d) => d.targets.some(t => {
      const hp = t.state.hp !== null && t.state.hp !== undefined ? t.state.hp : t.hp || 1;
      const mhp = t.state.maxHp || t.maxHp || hp;
      return hp < mhp * 0.3;
    }) ? 30 : 0);
  });
  ai.addAction("attack_strongest", (a) => {
    a.condition((d) => d.bloodThirst >= 7 && d.targets && d.targets.length);
    a.score("base_aggression", () => 25);
    a.score("high_damage_target", (d) => {
      const md = Math.max(...d.targets.map(t => t.damage || 0));
      return md >= 6 ? 40 : 0;
    });
    a.score("tanky_target", (d) => {
      const mh = Math.max(...d.targets.map(t => t.hp || 1));
      return mh >= 30 ? 30 : 0;
    });
    a.score("survival_penalty", (d) => d.playerHp < d.playerMaxHp * 0.3 ? -30 : 0);
  });
  ai.addAction("attack_attacker", (a) => {
    a.condition((d) => d.bloodThirst >= 7 && d.targets && d.targets.length);
    a.score("retaliate", (d) => d.lastAttackerId && d.targets.some(t => t.id === d.lastAttackerId) ? 50 : 0);
    a.score("hostile_target", (d) => d.targets.some(t => (t.tags || []).some(tag => ["guard", "hostile"].includes(tag))) ? 30 : 0);
  });
  ai.addAction("stand_down", (a) => {
    a.condition((d) => d.bloodThirst < 7 || !d.targets || !d.targets.length);
    a.score("low_thirst", () => 80);
    a.score("no_targets", (d) => !d.targets || !d.targets.length ? 100 : 0);
  });
  return ai;
}

function buildAiProfile_homunculus() {
  const ai = new UtilityAi();
  ai.addAction("bronze_bull", (a) => {
    a.condition((d) => d.alive.includes("bronze_bull"));
    a.score("heavy_hit", (d) => d.attackerDamage > 10 ? 50 : 0);
    a.score("tough_enemy", (d) => (d.attackerTags || []).some(t => ["heavy", "boss", "armed"].includes(t)) ? 40 : 0);
    a.score("healthy", (d) => (d.homunculusHp.bronze_bull || 0) > 70 ? 30 : 0);
  });
  ai.addAction("lion_of_saara", (a) => {
    a.condition((d) => d.alive.includes("lion_of_saara"));
    a.score("magic_threat", (d) => (d.attackerTags || []).some(t => ["mystic", "intelligent"].includes(t)) ? 40 : 0);
    a.score("elemental", (d) => d.attackerDamageType && ["fire", "poison"].includes(d.attackerDamageType) ? 30 : 0);
    a.score("healthy", (d) => (d.homunculusHp.lion_of_saara || 0) > 50 ? 20 : 0);
  });
  ai.addAction("meat_slave", (a) => {
    a.condition((d) => d.alive.includes("meat_slave"));
    a.score("base", () => 10);
    a.score("physical", (d) => !d.attackerDamageType || d.attackerDamageType === "physical" ? 25 : 0);
    a.score("beast_hunter", (d) => (d.attackerTags || []).some(t => ["beast", "undead"].includes(t)) ? 20 : 0);
  });
  ai.addAction("all_three", (a) => {
    a.condition((d) => ["bronze_bull", "lion_of_saara", "meat_slave"].every(id => d.alive.includes(id)));
    a.score("master_in_danger", (d) => d.alchemistHp !== undefined && d.alchemistHp < 30 ? 80 : 0);
    a.score("blade_threat", (d) => d.playerHasSealedBlade ? 60 : 0);
  });
  return ai;
}

function buildAiProfile_raid() {
  const ai = new UtilityAi();
  ai.addAction("spawn_scout", (a) => {
    a.condition((d) => !d.hasRaidThisTurn);
    a.score("night", (d) => d.isNight ? 40 : 0);
    a.score("desert", (d) => d.inDesert ? 30 : 0);
    a.score("camp_known", (d) => d.campDiscovered ? 20 : 0);
    a.score("player_at_camp", (d) => d.playerInCamp ? 25 : 0);
    a.score("player_weak", (d) => d.playerHp < d.playerMaxHp * 0.4 ? 25 : 0);
  });
  ai.addAction("spawn_raiders", (a) => {
    a.condition((d) => !d.hasRaidThisTurn);
    a.score("night", (d) => d.isNight ? 30 : 0);
    a.score("desert", (d) => d.inDesert ? 40 : 0);
    a.score("raid_camp", (d) => d.playerInCamp ? 55 : 0);
    a.score("player_weak", (d) => d.playerHp < d.playerMaxHp * 0.5 ? 35 : 0);
    a.score("bad_rep", (d) => d.playerRep < -2 ? 30 : 0);
    a.score("fatigue", (d) => d.raidCount > 2 ? -50 : 0);
  });
  ai.addAction("ambush_exit", (a) => {
    a.condition((d) => !d.hasRaidThisTurn);
    a.score("in_transit", (d) => d.inTransit ? 50 : 0);
    a.score("heading_to_camp", (d) => d.headingToCamp ? 40 : 0);
    a.score("night", (d) => d.isNight ? 20 : 0);
  });
  ai.addAction("no_raid", (a) => {
    a.score("daytime", (d) => !d.isNight ? 50 : 0);
    a.score("in_city", (d) => d.inCity ? 40 : 0);
    a.score("healthy_penalty", (d) => d.playerHp > d.playerMaxHp * 0.8 ? -10 : 0);
    a.score("hunter_faction", (d) => d.playerFate === "bone_hunter" ? 30 : 0);
  });
  return ai;
}

AI_PROFILES.bone_hunter = buildAiProfile_boneHunter();
AI_PROFILES.demon_blade = buildAiProfile_demonBlade();
AI_PROFILES.homunculus = buildAiProfile_homunculus();
AI_PROFILES.raid = buildAiProfile_raid();

function evaluateAi(profile, data) {
  const ai = AI_PROFILES[profile];
  if (!ai) return { action: "none", score: -Infinity };
  return ai.evaluate(data);
}
