import { hashSeed, mulberry32 } from '../world/DungeonGenerator';

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

export const GIVERS: Omit<QuestGiver, 'id' | 'reputation'>[] = [
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
        '"I don\'t learn names until the second visit. Saves me writing them on things twice."',
        '"That edge was sharpened by somebody in a hurry. I can fix the edge. I can\'t fix the hurry."',
      ],
      acquaintance: [
        '"Not bad, not bad. You\'ve got more grit than most. Here — take this, it\'ll serve you well."',
        '"I hear the things you\'ve done. The roads are safer for it. Keep at it."',
        '"Your armour came back dented in the front. That means you were facing the thing. Good."',
        '"I\'ve started keeping a bar of the good stock back on the days you\'re expected. Don\'t make anything of it."',
      ],
      trusted: [
        '"You\'ve earned my respect. When you need a masterwork edge, you\'ll get it. No charge."',
        '"The forge runs hot for a friend. I\'ve got a commission from the guild — you\'ll want to hear this."',
        '"Bring me the broken one and I\'ll tell you how it died. Then I\'ll make you something that won\'t."',
        '"I\'ve buried a lot of customers, so listen: that grip is wrong for your hand and it has been for a year."',
      ],
      legend: [
        '"Legends walk through my shop now, do they? The Anvil-Choir sang of your deeds. You have my finest work — always."',
        '"Bards come to me asking what you look like. I tell them: like steel and fire. Now what can I forge for you?"',
        '"Half the apprentices in the province applied here this spring because you buy your steel from me. I raised my prices. Not yours."',
        '"There\'s a smith three towns over stamping my mark on rubbish and selling it as the blade you carry. Do what you like about that — but you should know."',
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
        '"You may look at the shelf. Looking. The verb has limits and I am watching you approach them."',
        '"You want the ruins explained in one sentence. I have written four hundred pages and I remain unsure. Take a lamp."',
      ],
      acquaintance: [
        '"I see you\'ve survived a few floors. Most don\'t. Perhaps you\'re worth briefing on what lies below."',
        '"Your kill ledger is... impressive. The Lich of the Fifth Floor would be nervous."',
        '"You came back with the seal intact and the note I gave you unread. Two out of three. I am revising my estimate upward."',
        '"Sit down. I have a question about the third floor and nobody honest to ask it of."',
      ],
      trusted: [
        '"I\'ve been studying these ruins for twenty years. You\'ve seen more in a week. Let me show you my research."',
        '"The ley lines converge beneath the deepest dungeon. Something ancient stirs — and you may be the only ones who can stop it."',
        '"I have annotated your account of the lower halls. Eleven corrections, and one thing I had entirely wrong. Thank you for that."',
        '"My colleagues would have you tested, catalogued, and thanked in a footnote. I would rather simply ask. Will you go back down?"',
      ],
      legend: [
        '"You\'ve touched the heart of the underdark. The Council of Mages has heard your name. I have... a proposition."',
        '"My life\'s work leads to one truth: the dungeon is alive, and it knows you. What we do next must be deliberate."',
        '"There is a chapter of my work that exists only because of you. I have titled it badly, but it exists."',
        '"I have stopped writing down where you go. If the wrong reader finds my notes, they find you. That is a new sort of caution for me."',
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
        '"You needn\'t kneel. Most who come to me can\'t, by the time they come."',
        '"I will bless your steel if you ask. I would rather bless your judgement — it sees far more use."',
      ],
      acquaintance: [
        '"You\'ve returned. The temple bells rang when you left — I prayed for your safe return. It worked, it seems."',
        '"The spirits speak of you. They are... grateful. Keep the faith, and Pelor will keep you."',
        '"Four names came off my list of the missing this month. Three of them because of you. I have not forgotten the fourth."',
        '"You have started leaving coin in the box without being seen. I see everything in this room. Thank you."',
      ],
      trusted: [
        '"The temple\'s relics are protected, but one sacred chalice was lost in the deep. Recover it, and the blessing is yours."',
        '"The undead grow bold. Something commands them from below. You must find what it is — and destroy it."',
        '"I sat with the ones you carried in. Two of them will walk again. I wanted you to hear that from me and not from a ledger."',
        '"There is a grave in my yard with nobody in it. I would like very much to correct that, and it is a long way down."',
      ],
      legend: [
        '"The gods themselves whisper your name. The high priestess asks: will you carry Pelor\'s light into the deepest dark?"',
        '"Your deeds echo in the halls of heaven. The temple has a task for you — one that could change everything."',
        '"They light candles for you here now, while you are still alive. I have told them it is improper. They keep doing it."',
        '"Whatever you have become out there, come in and sit down. The soup is the same soup. That is rather the point of us."',
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
        '"Rooms are two silver, ale is one, and the story you tell at my bar is free. To me."',
        '"I don\'t ask where a thing came from. I ask what you want for it. Much cleaner conversation all round."',
      ],
      acquaintance: [
        '"You\'re becoming a regular! The good stuff is on me tonight — and I\'ve got a proposition for you."',
        '"Folks are talking about you. The constable wants to meet, and the merchants are raising their offers."',
        '"You\'ve got a tab now. That\'s trust, that is. Ruinous, but trust."',
        '"Three people asked after you this week. Two got nothing and the third got a very nice lie. You\'re welcome."',
      ],
      trusted: [
        '"Between you and me, there\'s a shipment coming through — high-quality goods from the ruins. Interested?"',
        '"You\'ve got the kind of reputation that opens doors. And locks. Care to make some quick coin?"',
        '"I\'ve put your name on the good room. Window that opens, bolt that works — better than the lord\'s guest quarters, and I\'ve seen both."',
        '"The buyer for that sort of thing is in the next town and he\'s a snake. But he\'s my snake. Sixty-forty and I handle him."',
      ],
      legend: [
        '"The legendary adventurers drink at MY bar! First round\'s on the house — forever. Now let me tell you about the job..."',
        '"I\'ve got connections in every town. Word is there\'s a vault that hasn\'t been cracked in centuries. Interested?"',
        '"Had the sign repainted with your lot on it. Business up forty percent, wife not speaking to me. Worth it."',
        '"Someone\'s buying up debts across three towns and asking after your habits. I paid good coin for that. Consider it a gift."',
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
        '"Names, trades, and how long you\'re staying. Not because I suspect you. Because I write everything down."',
        '"What you do out in the ruins is your business. What you carry back through my gate is mine."',
      ],
      acquaintance: [
        '"Not bad. You\'ve got the makings of a real enforcer. The guild could use people like you."',
        '"The constable\'s office has a wall of bounties. Your name is starting to appear on the good side."',
        '"You handed in the full count and didn\'t skim the purse. That\'s rarer than the fighting."',
        '"I\'ve told the gate to stop searching your packs. Don\'t make me look stupid."',
      ],
      trusted: [
        '"The bandit captain on the east road is getting bold. I need someone who can end this — permanently."',
        '"You\'ve earned my trust. Here\'s the real job: there\'s a criminal ring operating from the old ruins."',
        '"Eleven men and forty miles of road. That arithmetic is the whole reason I\'m talking to you instead of charging you."',
        '"Off the record: the magistrate is bought. On the record I said nothing and you heard nothing. Now. The job."',
      ],
      legend: [
        '"The town council has declared you an official enforcer. Here\'s your badge — and the keys to the armory."',
        '"They\'re calling you the Blade of the Realm. I need your help with something the guard can\'t handle alone."',
        '"I put in for a transfer eight years running. Stopped last spring. Roads are quiet enough now that I\'d miss it."',
        '"My lads model themselves on you, which is flattering and a small tactical disaster. Try to be seen doing something sensible."',
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
        '"You\'re carrying too much, and the wrong half of it. No, I\'m not going to tell you which half."',
        '"Water on the left fork. Nothing on the right for a day and a half. That\'s the whole map, and it\'s free."',
      ],
      acquaintance: [
        '"You\'ve made it back from the deep woods. Most don\'t. Want to know what I\'ve been tracking?"',
        '"The forest paths are shifting. Something is stirring the beasts into a frenzy. Be careful out there."',
        '"You came back by the ridge instead of the valley. Somebody in your party is learning."',
        '"I found your fire ring. Cold, buried, nothing left out for the crows. Whoever did that has my respect."',
      ],
      trusted: [
        '"The beasts are moving in patterns I\'ve never seen. There\'s a nest — a big one — in the northern woods. Interested?"',
        '"I\'ve been scouting for twenty years. You\'re the first outsider I\'d trust with what I\'ve found."',
        '"I\'ve been cutting marks for you since spring. Diamond is water, cross is turn back. Try to remember which is which."',
        '"The elk have moved a valley east, and they don\'t do that for weather. Come and look at what they\'re walking around."',
      ],
      legend: [
        '"The forest speaks of you. The old trees remember your footsteps. I have a map to something... extraordinary."',
        '"The beasts bow to you now. The wilds are yours to command — and I\'m yours to guide."',
        '"Two shepherds asked me to teach their girls to track. Said they wanted to be like your lot. I told them the tracking comes first."',
        '"I don\'t follow anyone. I\'ll walk beside you as far as the pass, and further if you ask properly."',
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
        '"You came in the front. Everyone does. Once."',
        '"I know four things about you already and you have told me none of them. Sit down."',
      ],
      acquaintance: [
        '"You\'re getting a reputation. The Guild has taken notice — and we\'re not the only ones."',
        '"The constable thinks he runs this town. He\'s wrong. We do. And you could be useful."',
        '"You didn\'t count the payment out in the street. Small thing. Small things are what I write down."',
        '"Somebody was asking which room you sleep in. They\'ve stopped asking. You\'re welcome."',
      ],
      trusted: [
        '"The Guild has a job for you. High risk, high reward. The kind of work that makes or breaks careers."',
        '"You\'ve proven you can be trusted. Here\'s the real ledger — the one the constable doesn\'t see."',
        '"The lock on your door was decorative. I\'ve replaced it. You\'ll notice your key still turns — that\'s rather the point."',
        '"There are three ways out of this town the constable doesn\'t know about. You now know two of them."',
      ],
      legend: [
        '"The Shadow Council knows your name. You are one of us now — and that means protection. And targets."',
        '"Legends don\'t knock twice. You have our full support — and every lock in the city is yours."',
        '"You\'ve become a unit of measurement. \'Quiet as them.\' \'Quick as them.\' I loathe it and I use it constantly."',
        '"The Guild took a vote on whether to be frightened of you. It was close. I abstained, which is its own answer."',
      ],
    },
  },
  {
    name: 'Odalys Pike',
    title: 'Apothecary',
    portrait: '⚗️',
    portraitColor: '#9c7',
    backstory: 'A gnome who grinds, steeps, and labels everything that comes out of the wilds. She pays by weight for monster parts and keeps a separate shelf for the ones she has not identified yet.',
    specialty: 'nature',
    repPerQuest: 15,
    dialogue: {
      stranger: [
        '"Everything is poison. The interesting question is how much, and how fast. Do come in."',
        '"I buy claws, glands, spores and livers. Fresh, ideally. I won\'t ask how, and you won\'t tell me at length."',
        '"That cut will go bad by Thursday. Here. No charge — I want to see how it heals."',
      ],
      acquaintance: [
        '"You brought it back in the jar instead of the sack. Do you know how rare that is? Thank you."',
        '"I\'ve named a tincture after this town. It\'s the third best thing I make. Take a bottle."',
        '"Your healer has been buying my willow-bark by the armful. Tell her the powder is cheaper and works faster."',
      ],
      trusted: [
        '"There\'s a spore two floors down that stops bleeding, and stops rather more than that. I need a live sample and someone who will read the label."',
        '"I\'ve written out what to do if any of you are bitten by the grey ones. Memorise it. I will be testing you."',
        '"Half of what I know came out of your packs. The other half I invented, and you have not caught me at it yet."',
      ],
      legend: [
        '"Physicians write to me from two provinces away asking what you take before a fight. I tell them: breakfast."',
        '"I have a shelf now that is only things you brought me. The jar at the end still moves and we are all pretending not to notice."',
        '"When you die — and everyone does — I would like the first hour with you. Professionally. Do think about it."',
      ],
    },
  },
  {
    name: 'Hob Wickery',
    title: 'Gravekeeper',
    portrait: '⚰️',
    portraitColor: '#998',
    backstory: 'He has dug every grave in this yard for thirty-one years and knows exactly which ones have stayed shut. He is not gloomy about it. He is simply the only person in town who keeps the count.',
    specialty: 'faith',
    repPerQuest: 17,
    dialogue: {
      stranger: [
        '"You\'ll be wanting the temple. I only do the last part."',
        '"Thirty-one years, four hundred and nine graves. Two didn\'t hold. I\'d like that number to stay where it is."',
        '"Don\'t walk on the flat ground by the wall. Nothing sinister. It\'s just recent."',
      ],
      acquaintance: [
        '"You came back. I\'d already chosen where you\'d go. I\'ll leave it unmarked a while longer."',
        '"There\'s a stone by the yew with the name worn clean off. If you\'re ever down that deep, listen for it."',
        '"Digging tells you things. Ground that\'s been turned twice, for one. I\'ve turned three plots twice this year."',
      ],
      trusted: [
        '"I keep the book of who\'s where. Tell me what you put down in the dark and I\'ll tell you whether we buried it."',
        '"Sit on the wall a while. Everyone who works underground ends up talking to me eventually. Better now than later."',
        '"Something walked out of plot sixty-one. I filled it in and said nothing. I\'m saying it now, to you, and to nobody else."',
      ],
      legend: [
        '"They\'ll want you under the chancel with the lords. Say no. The yard is better company and the drainage is honest."',
        '"I\'ve stopped writing your names in the book of the likely. Felt like tempting it, and I don\'t tempt things."',
        '"When it\'s time — and I hope I\'m gone first — I\'ve kept the corner by the yew. Best light in the yard, morning and evening."',
      ],
    },
  },
  {
    name: 'Sera Vayle',
    title: 'Caravan Master',
    portrait: '🧭',
    portraitColor: '#c9a',
    backstory: 'She has run the same three roads for twenty years and can price any stretch of them by the hour. She hires guards the way other people buy insurance, and complains about the cost exactly as much.',
    specialty: 'trade',
    repPerQuest: 14,
    dialogue: {
      stranger: [
        '"Guard work pays four silver a day and a share if it goes badly. Most of my hires never earn the share."',
        '"I don\'t need heroes. I need four people who stay awake and don\'t rob me. Are you four people?"',
        '"The eastern road is priced at eleven percent this month. That number is a rumour, a threat and a schedule, all at once."',
      ],
      acquaintance: [
        '"You delivered the crate sealed. Do you know how novel that is? I\'ve raised your rate."',
        '"My drivers asked for you by name for the next run. They don\'t ask for anyone by name."',
        '"Come by the yard before you leave. There\'s always something going the way you\'re going, and it always pays."',
      ],
      trusted: [
        '"I\'ll put it plainly: I\'ve stopped insuring the eastern route and started hiring you instead. That is a compliment written in money."',
        '"There\'s a stretch of road I want cleared, not guarded. Different work, different rate, and I know exactly what I\'m asking."',
        '"Take the ledger for the northern run. If I\'m not back, the drivers get paid first and the creditors can form a queue."',
      ],
      legend: [
        '"Three houses have offered to buy my routes on the strength of your name being attached to them. I said no. I say no a great deal lately."',
        '"You\'ve made the eastern road safe enough that the tolls went up. That is what success looks like out here, and yes, I am complaining."',
        '"Whatever road you\'re on next, tell me, and I\'ll have wagons on it inside the month. I have never once been wrong about you."',
      ],
    },
  },
];

/**
 * Generate quest-givers for a town. Each town gets 2-3 NPCs from the pool,
 * seeded by the town's id for consistency across saves.
 */
export function generateQuestGivers(townId: string): QuestGiver[] {
  // Seeded by the town id through the dungeon generator's hash and PRNG. The
  // hand-rolled multiplier this replaced masked its state to 31 bits instead
  // of reducing it properly, so its low bits cycled and a town id that hashed
  // to zero never shuffled at all: those towns always got the first two
  // givers in the list.
  const rng = mulberry32(hashSeed(townId));

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
      slay_kind: [
        "The beasts are multiplying. Someone needs to thin the pack.",
        "It is a numbers problem, and you are the number.",
        "Kill enough of them and the rest will move on. That is the entire strategy.",
      ],
      slay_boss: [
        "There is a monster at the heart of the delve that needs slaying.",
        "Cut the head off and the body stops organising itself. It usually works.",
        "Everything down there takes its orders from one thing. End the one thing.",
      ],
      reach_floor: [
        "I need you to push deep and come back alive.",
        "Go down until it gets bad, then one floor further, then come home.",
        "I want to know what is on that level, and I want you standing when you tell me.",
      ],
      clear_floor: [
        "Nothing left breathing on that level. I will take your word for the count.",
        "Sweep it end to end. Corners, cupboards, the lot.",
        "Half-cleared is not cleared. Half-cleared just means they know you are coming.",
      ],
      collect_item: [
        "Whatever is down there, bring it up. It pays for the wall repairs.",
        "Loot is a resource like any other. Consider it requisitioned.",
      ],
    },
    lore: {
      reach_floor: [
        "The ruins hold secrets we need. Go deeper and return with knowledge.",
        "Depth is the one variable I cannot control from here. Reach the level and write down everything.",
        "I need an eyewitness at that depth, not another rumour copied out of a rumour.",
      ],
      slay_boss: [
        "Something guards the deepest secrets. Remove it.",
        "It is guarding, and guarding implies knowing. Kill it and I will read what it was keeping.",
        "I would rather study it alive. I have been overruled by the number of corpses it has made.",
      ],
      slay_kind: [
        "They breed to a pattern, and the pattern is telling me something. Reduce the sample size.",
        "A dead specimen answers questions a live one will not sit still for.",
      ],
      clear_floor: [
        "An empty floor can be measured. A populated one can only be survived. Empty it.",
        "I want that level quiet long enough to draw it properly.",
      ],
      collect_item: [
        "Bring back objects, not descriptions. Descriptions are where the errors breed.",
        "Anything with writing on it. Anything at all with writing on it.",
      ],
    },
    faith: {
      slay_kind: [
        "The dead walk where they should not. Put them to rest.",
        "They were people once. That is not a reason to spare them; it is a reason to be quick.",
        "Put them down cleanly, then say the words over them. I will teach you the words.",
      ],
      slay_boss: [
        "A great evil festers in the depths. Only faith and steel will end it.",
        "Something down there is holding the dead awake. Let them sleep.",
        "I have prayed over this for a week and the answer keeps being: somebody has to go.",
      ],
      reach_floor: [
        "There is ground down there that has not been blessed in six hundred years. Stand on it and I will do the rest.",
        "Go as deep as the old shrine. If it is still standing, I would dearly like to hear it.",
      ],
      clear_floor: [
        "Clear it, and the temple will consecrate it. That is the order it has to happen in.",
        "Every one of them left standing is a soul still bound. Finish the work.",
      ],
      collect_item: [
        "The temple's property went down there. I want it back on the altar, not in a collection.",
        "Recover what was taken. I will not ask what you do with the rest.",
      ],
    },
    trade: {
      reach_floor: [
        "There is treasure below that could make us both rich.",
        "Nobody has priced that level because nobody has stood on it. Be the first, and the margin is ours.",
        "Go deep, note what is down there, and tell no one else the number.",
      ],
      slay_kind: [
        "These creatures are bad for business. Clear them out.",
        "They are eating my margin one wagon at a time. Reduce them.",
        "Every one you kill is a percentage point off my insurance. I can be very precise about this.",
      ],
      slay_boss: [
        "Nothing moves on that road while it is alive. Kill it and the road is worth money again.",
        "I have costed the funeral and I have costed the contract. The contract is cheaper. Take it.",
      ],
      clear_floor: [
        "An empty floor is a warehouse. A full one is a problem. Make me a warehouse.",
        "Clear it and I will have wagons at the entrance inside a week.",
      ],
      collect_item: [
        "Bring back whatever fits in a crate. I will find a buyer for the rest.",
        "I am paying by the piece, not by the story. Fill the crate.",
      ],
    },
    stealth: {
      slay_kind: [
        "Some things need to disappear quietly.",
        "A few of them. Not all of them. If it looks deliberate, it stops working.",
        "Quietly, and not all in the same room. You understand the shape of the request.",
      ],
      reach_floor: [
        "I need you to go somewhere... discreetly.",
        "Get to that level without anything upstairs noticing you went. That is the job — the floor is incidental.",
        "Down, look, back. No stories in the taproom afterwards.",
      ],
      slay_boss: [
        "It has been useful to us, which is precisely why it has to go now. Nothing personal, professionally speaking.",
        "Do it at the bottom, where the noise stays put.",
      ],
      clear_floor: [
        "Empty the level. Yes, all of it — for once this is not a subtle job.",
        "Somebody wants that floor with nothing on it. I am not asking who, and neither are you.",
      ],
      collect_item: [
        "Bring up whatever is portable. Portable is a broad word and I am using it broadly.",
        "The Guild takes a third and asks nothing. That is a better deal than it sounds.",
      ],
    },
    nature: {
      slay_kind: [
        "The natural order is disrupted. Restore it.",
        "There are too many of them for the ground that feeds them. Thin them and it settles.",
        "Take the ones at the edge of the pack. The rest will read the message.",
      ],
      reach_floor: [
        "The wilds have a heart, and we need to find it.",
        "Whatever is down there is pushing the animals up and out. Go and find the bottom of it.",
        "The cold coming out of that hole is wrong for the season. Go down until you know why.",
      ],
      slay_boss: [
        "Everything in that valley is running from one thing. Remove it and the valley comes back.",
        "It has no business being here and it will not leave on its own.",
      ],
      clear_floor: [
        "Empty that level and the ones above it will empty themselves. That is how it works down there.",
        "Clear it out, and give the ground a season to forget them.",
      ],
      collect_item: [
        "Bring back the seeds, the spores, and the wet things in jars. Especially the wet things.",
        "Take what will grow back. Leave what will not. I will know.",
      ],
    },
  };
  const pool = specialtyDialogues[npc.specialty]?.[questKind];
  if (pool && pool.length > 0) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return getDialogue(npc);
}

/** What crossing into each tier actually looks like from the other side of the counter. */
const TIER_CHANGE: Record<ReputationTier, string> = {
  stranger: 'they are still taking your measure',
  acquaintance: 'they have started saying your name without the pause in front of it',
  trusted: 'they have begun telling you things they do not tell the room',
  legend: 'they have stopped explaining who you are to people, because everyone already knows',
};

/**
 * Award reputation for completing a quest. Returns a message if the tier changed.
 */
export function awardReputation(npc: QuestGiver, questReward: number): string | null {
  const oldTier = getReputationTier(npc);
  npc.reputation += npc.repPerQuest + Math.floor(questReward / 50);
  const newTier = getReputationTier(npc);
  if (oldTier !== newTier) {
    return `Your standing with ${npc.name} grows — ${TIER_CHANGE[newTier]}.`;
  }
  return null;
}
