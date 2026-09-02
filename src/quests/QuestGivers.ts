/**
 * QuestGivers — named NPCs who live in towns and hand out quests with
 * personality. Each town gets 2-3 quest-givers drawn from a pool of
 * archetypes (blacksmith, apothecary, constable, priest, merchant, etc.),
 * each with a portrait (CSS emoji + color), backstory, greeting/dialogue
 * lines that shift as reputation grows, and quests tailored to their role.
 *
 * Reputation per NPC grows as the party completes their quests, unlocking
 * new dialogue tiers (stranger → acquaintance → trusted → legend).
 */

export type ReputationTier = 'stranger' | 'acquaintance' | 'trusted' | 'legend';

export interface QuestGiver {
  id: string;
  name: string;
  title: string;
  /** Emoji + color for the portrait header. */
  portrait: string;
  portraitColor: string;
  backstory: string;
  /** Dialogue lines keyed by reputation tier. */
  dialogue: Record<ReputationTier, string[]>;
  /** The NPC's specialty: affects what quests and rewards they offer. */
  specialty: 'combat' | 'lore' | 'trade' | 'faith' | 'stealth' | 'nature';
  /** Reputation earned per completed quest for this NPC. */
  repPerQuest: number;
  /** Current reputation with this NPC. */
  reputation: number;
}

const GIVERS: Omit<QuestGiver, 'id' | 'reputation'>[] = [
  {
    name: 'Brenna Ironforge',
    title: 'Town Blacksmith',
    portrait: '🔨',
    portraitColor: '#c88',
    backstory: 'A master smith who can mend any blade but whose own patience is worn thin. She has seen more heroes leave for the dark than return.',
    specialty: 'combat',
    repPerQuest: 20,
    dialogue: {
      stranger: [
        '"Another band of adventurers? The road to the ruins is that way — try not to break my best steel."',
        '"If you\'re heading into the deep, you\'ll want proper gear. Come back alive and I\'ll sharpen your blades free."',
      ],
      acquaintance: [
        '"Not bad, not bad. You\'ve got more grit than most. Here — take this, it\'ll serve you well."',
        '"I hear the things you\'ve done. The roads are safer for it. Keep at it."',
      ],
      trusted: [
        '"You\'ve earned my respect. When you need a masterwork edge, you\'ll get it. No charge."',
        '"The forge runs hot for a friend. I\'ve got a commission from the guild — you\'ll want to hear this."',
      ],
      legend: [
        '"Legends walk through my shop now, do they? The Anvil-Choir sang of your deeds. You have my finest work — always."',
        '"Bards come to me asking what you look like. I tell them: like steel and fire. Now what can I forge for you?"',
      ],
    },
  },
  {
    name: 'Thalen Mistweaver',
    title: 'Town Wizard',
    portrait: '📖',
    portraitColor: '#88d',
    backstory: 'An elderly tiefling who came to this town to study ancient ruins. His notes are full of marginalia and complaints about adventurers who can\'t read runes.',
    specialty: 'lore',
    repPerQuest: 15,
    dialogue: {
      stranger: [
        '"Hmm? Oh, another delver. Don\'t touch the scrolls. And whatever you do, don\'t read the blue ones aloud."',
        '"The ruins hold secrets that predate this town by millennia. Handle them with respect — or at least with gloves."',
      ],
      acquaintance: [
        '"I see you\'ve survived a few floors. Most don\'t. Perhaps you\'re worth briefing on what lies below."',
        '"Your kill ledger is... impressive. The Lich of the Fifth Floor would be nervous."',
      ],
      trusted: [
        '"I\'ve been studying these ruins for twenty years. You\'ve seen more in a week. Let me show you my research."',
        '"The ley lines converge beneath the deepest dungeon. Something ancient stirs — and you may be the only ones who can stop it."',
      ],
      legend: [
        '"You\'ve touched the heart of the underdark. The Council of Mages has heard your name. I have... a proposition."',
        '"My life\'s work leads to one truth: the dungeon is alive, and it knows you. What we do next must be deliberate."',
      ],
    },
  },
  {
    name: 'Sister Mirael',
    title: 'Temple Priestess',
    portrait: '✨',
    portraitColor: '#da8',
    backstory: 'A halfling cleric of Pelor who tends the wounded and mourns the dead. She asks adventurers to recover relics and put restless spirits to rest.',
    specialty: 'faith',
    repPerQuest: 18,
    dialogue: {
      stranger: [
        '"The temple welcomes all who seek to do good. The dead below do not rest easy — perhaps you can help them."',
        '"I won\'t lie to you: the things in that darkness are beyond reason. Only faith and steel will see you through."',
      ],
      acquaintance: [
        '"You\'ve returned. The temple bells rang when you left — I prayed for your safe return. It worked, it seems."',
        '"The spirits speak of you. They are... grateful. Keep the faith, and Pelor will keep you."',
      ],
      trusted: [
        '"The temple\'s relics are protected, but one sacred chalice was lost in the deep. Recover it, and the blessing is yours."',
        '"The undead grow bold. Something commands them from below. You must find what it is — and destroy it."',
      ],
      legend: [
        '"The gods themselves whisper your name. The high priestess asks: will you carry Pelor\'s light into the deepest dark?"',
        '"Your deeds echo in the halls of heaven. The temple has a task for you — one that could change everything."',
      ],
    },
  },
  {
    name: 'Dax Rumblefoot',
    title: 'Innkeeper & Fence',
    portrait: '🍺',
    portraitColor: '#ca6',
    backstory: 'A jovial half-orc who runs the tavern and quietly fences whatever treasure adventurers bring back. Knows every rumor in town.',
    specialty: 'trade',
    repPerQuest: 12,
    dialogue: {
      stranger: [
        '"Welcome, welcome! Buy a drink, tell me a story, and maybe we can do business. Gold talks louder than words here."',
        '"Heard you came in through the north gate. Word travels fast in a town this size. What\'s your poison?"',
      ],
      acquaintance: [
        '"You\'re becoming a regular! The good stuff is on me tonight — and I\'ve got a proposition for you."',
        '"Folks are talking about you. The constable wants to meet, and the merchants are raising their offers."',
      ],
      trusted: [
        '"Between you and me, there\'s a shipment coming through — high-quality goods from the ruins. Interested?"',
        '"You\'ve got the kind of reputation that opens doors. And locks. Care to make some quick coin?"',
      ],
      legend: [
        '"The legendary adventurers drink at MY bar! First round\'s on the house — forever. Now let me tell you about the job..."',
        '"I\'ve got connections in every town. Word is there\'s a vault that hasn\'t been cracked in centuries. Interested?"',
      ],
    },
  },
  {
    name: 'Constable Varek',
    title: 'Town Constable',
    portrait: '⚔️',
    portraitColor: '#6a8',
    backstory: 'A grizzled veteran who keeps the peace and organizes the town\'s defense. He offers bounties for dangerous creatures and organized crime.',
    specialty: 'combat',
    repPerQuest: 22,
    dialogue: {
      stranger: [
        '"The town guard can\'t handle everything. If you want to earn your keep, start by clearing the roads."',
        '"Bandits, beasts, worse — the roads aren\'t safe. Prove you can fight, and there\'s coin in it."',
      ],
      acquaintance: [
        '"Not bad. You\'ve got the makings of a real enforcer. The guild could use people like you."',
        '"The constable\'s office has a wall of bounties. Your name is starting to appear on the good side."',
      ],
      trusted: [
        '"The bandit captain on the east road is getting bold. I need someone who can end this — permanently."',
        '"You\'ve earned my trust. Here\'s the real job: there\'s a criminal ring operating from the old ruins."',
      ],
      legend: [
        '"The town council has declared you an official enforcer. Here\'s your badge — and the keys to the armory."',
        '"They\'re calling you the Blade of the Realm. I need your help with something the guard can\'t handle alone."',
      ],
    },
  },
  {
    name: 'Lyra Windwalker',
    title: 'Ranger Scout',
    portrait: '🏹',
    portraitColor: '#8c8',
    backstory: 'A wood elf who has mapped every trail within a hundred miles. She sells survival gear and knows which monsters haunt which biomes.',
    specialty: 'nature',
    repPerQuest: 16,
    dialogue: {
      stranger: [
        '"The wilds don\'t care about your armor. Stay on the road, keep your eyes open, and don\'t trust the silence."',
        '"I\'ve seen what lurks in the forest. Wolves are the least of your worries."',
      ],
      acquaintance: [
        '"You\'ve made it back from the deep woods. Most don\'t. Want to know what I\'ve been tracking?"',
        '"The forest paths are shifting. Something is stirring the beasts into a frenzy. Be careful out there."',
      ],
      trusted: [
        '"The beasts are moving in patterns I\'ve never seen. There\'s a nest — a big one — in the northern woods. Interested?"',
        '"I\'ve been scouting for twenty years. You\'re the first outsider I\'d trust with what I\'ve found."',
      ],
      legend: [
        '"The forest speaks of you. The old trees remember your footsteps. I have a map to something... extraordinary."',
        '"The beasts bow to you now. The wilds are yours to command — and I\'m yours to guide."',
      ],
    },
  },
  {
    name: 'Mira Shadowhand',
    title: 'Thieves\' Guild Contact',
    portrait: '🗝️',
    portraitColor: '#88a',
    backstory: 'A mysterious figure who appears in alleyways and offers work that the constable would not approve of. Discretion is her currency.',
    specialty: 'stealth',
    repPerQuest: 14,
    dialogue: {
      stranger: [
        '"Shh. Not here. Come back after dark, and bring something valuable — information, if not gold."',
        '"The shadows have ears. And the ears have mouths. Tell me what you\'ve seen in the depths."',
      ],
      acquaintance: [
        '"You\'re getting a reputation. The Guild has taken notice — and we\'re not the only ones."',
        '"The constable thinks he runs this town. He\'s wrong. We do. And you could be useful."',
      ],
      trusted: [
        '"The Guild has a job for you. High risk, high reward. The kind of work that makes or breaks careers."',
        '"You\'ve proven you can be trusted. Here\'s the real ledger — the one the constable doesn\'t see."',
      ],
      legend: [
        '"The Shadow Council knows your name. You are one of us now — and that means protection. And targets."',
        '"Legends don\'t knock twice. You have our full support — and every lock in the city is yours."',
      ],
    },
  },
];

/**
 * Generate quest-givers for a town. Each town gets 2-3 NPCs from the pool,
 * seeded by the town's id for consistency across saves.
 */
export function generateQuestGivers(townId: string): QuestGiver[] {
  // Simple seeded shuffle based on town id
  let seed = 0;
  for (let i = 0; i < townId.length; i++) seed = ((seed << 5) - seed + townId.charCodeAt(i)) | 0;
  const rng = () => { seed = (seed * 16807 + 0) & 0x7fffffff; return (seed & 0x7fffffff) / 0x7fffffff; };

  const indices = GIVERS.map((_, i) => i);
  // Fisher-Yates shuffle with seeded RNG
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const count = 2 + Math.floor(rng() * 2); // 2-3 per town
  return indices.slice(0, count).map((gi, idx) => ({
    ...GIVERS[gi],
    id: `qg_${townId}_${idx}`,
    reputation: 0,
  }));
}

/**
 * Get the current reputation tier for an NPC.
 */
export function getReputationTier(npc: QuestGiver): ReputationTier {
  if (npc.reputation >= 80) return 'legend';
  if (npc.reputation >= 40) return 'trusted';
  if (npc.reputation >= 10) return 'acquaintance';
  return 'stranger';
}

/**
 * Get a random dialogue line for the NPC's current reputation tier.
 */
export function getDialogue(npc: QuestGiver): string {
  const tier = getReputationTier(npc);
  const lines = npc.dialogue[tier];
  return lines[Math.floor(Math.random() * lines.length)];
}

export function getQuestDialogue(npc: QuestGiver, questKind: string): string {
  const specialtyDialogues: Record<string, Record<string, string[]>> = {
    combat: {
      slay_kind: ["The beasts are multiplying. Someone needs to thin the pack."],
      slay_boss: ["There is a monster at the heart of the delve that needs slaying."],
      reach_floor: ["I need you to push deep and come back alive."],
    },
    lore: {
      reach_floor: ["The ruins hold secrets we need. Go deeper and return with knowledge."],
      slay_boss: ["Something guards the deepest secrets. Remove it."],
    },
    faith: {
      slay_kind: ["The dead walk where they should not. Put them to rest."],
      slay_boss: ["A great evil festers in the depths. Only faith and steel will end it."],
    },
    trade: {
      reach_floor: ["There is treasure below that could make us both rich."],
      slay_kind: ["These creatures are bad for business. Clear them out."],
    },
    stealth: {
      slay_kind: ["Some things need to disappear quietly."],
      reach_floor: ["I need you to go somewhere... discreetly."],
    },
    nature: {
      slay_kind: ["The natural order is disrupted. Restore it."],
      reach_floor: ["The wilds have a heart, and we need to find it."],
    },
  };
  const pool = specialtyDialogues[npc.specialty]?.[questKind];
  if (pool && pool.length > 0) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return getDialogue(npc);
}

/**
 * Award reputation for completing a quest. Returns a message if the tier changed.
 */
export function awardReputation(npc: QuestGiver, questReward: number): string | null {
  const oldTier = getReputationTier(npc);
  npc.reputation += npc.repPerQuest + Math.floor(questReward / 50);
  const newTier = getReputationTier(npc);
  if (oldTier !== newTier) {
    const titles: Record<ReputationTier, string> = {
      stranger: 'a stranger',
      acquaintance: 'an acquaintance',
      trusted: 'trusted',
      legend: 'a legend',
    };
    return `Your reputation with ${npc.name} grows — you are now ${titles[newTier]} in their eyes.`;
  }
  return null;
}
