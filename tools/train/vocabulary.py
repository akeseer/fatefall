"""
Vocabulary expansion for the DM order templates.

The first pass of templates in templates.py was too clipped. Real orders use a
far wider verb and noun vocabulary than "search the vault", and a bag-of-ngrams
model can only recognise words it has seen. These extras broaden that vocabulary
per intent. They are templates, not sentences copied from the acceptance set.

Merged into `T` at the bottom of templates.py.
"""

# fmt: off

EXTRA = {
    "move": [
        "take that passage {dir}", "follow the corridor {dir}", "follow the {dir} wall", "carry on {dir}",
        "shift {dir}", "edge {dir}", "nudge them {dir}", "push on {dir}", "keep on {dir}", "work your way {dir}",
        "head off {dir} a while", "try the {dir} way", "the {dir} route", "take the {dir} turn", "swing round {dir}",
        "move them {dir}", "walk them {dir}", "send them {dir}", "steer {dir}", "drift {dir}", "carry {dir}",
        "further {dir}", "a bit further {dir}", "keep pushing {dir}", "back {dir}", "cut {dir}",
        "down the {dir} passage", "along the {dir} corridor", "out the {dir} door", "through the {dir} arch",
    ],
    "stance:aggressive": [
        "be bold", "be brave", "no more caution", "stop sneaking around", "start swinging",
        "spoiling for a fight", "looking for trouble", "seek trouble out", "meet them head on",
        "stand and fight", "fight whatever you meet", "dont avoid anything", "no more running",
        "clear out whatever is down there", "put them to the sword", "cut them down", "show no mercy",
        "get stuck in", "wade in", "press the attack", "be the hunters", "make the first move",
        "carve a path", "kill on sight", "leave nothing standing", "aggression from here on",
    ],
    "stance:cautious": [
        "no risks", "no unnecessary risks", "play it careful", "dont start anything", "start nothing",
        "keep out of sight", "keep it quiet", "give them a wide berth", "leave them be",
        "slip by unnoticed", "avoid every fight", "no more fighting", "walk away from trouble",
        "prioritise staying alive", "safety first", "dont engage", "hold back", "keep your distance",
        "stay out of their way", "eyes open blades down", "softly softly", "treat everything as dangerous",
        "keep your heads down", "nobody dies today", "caution above all", "slip past whatever is there",
    ],
    "report": [
        "what condition is everyone in", "what shape are they in", "how badly hurt is everyone",
        "who is injured", "who needs healing", "who is closest to death", "give me the numbers",
        "how much health is left", "run me through the party", "the state of everyone",
        "how are they holding together", "anyone in trouble", "anyone in a bad way", "any of them dying",
        "how is morale", "give me the party breakdown", "party rundown", "rundown on everyone",
        "summarise the party", "where do we stand", "how are things looking", "how are we placed",
        "how banged up are they", "who is hurt worst", "is anyone about to go down",
    ],
    "look": [
        "describe this place", "what does this place look like", "what is it like here",
        "give me a description", "paint me a picture", "tell me about the surroundings",
        "whats around them", "what can they see", "describe what they see", "describe the surroundings",
        "whats this room like", "what does the chamber look like", "describe the scene",
        "give me the lay of the land", "what does it look like where they are", "narrate the room",
        "tell me what this place looks like", "set the scene for me", "whats it like in there",
    ],
    "inventory": [
        "what are they carrying", "what have they got on them", "whats in their bags",
        "what are they hauling", "what supplies are left", "what are they lugging about",
        "list their belongings", "list their stuff", "run through the packs", "show the packs",
        "how much money have they got", "how much coin is left", "count the purse",
        "whats in the bags", "everything they carry", "the contents of the packs",
    ],
    "gear": [
        "what is everyone wearing", "who is wielding what", "what are they armed with",
        "run me through their kit", "show their kit", "what armour are they in",
        "what weapons do they have out", "whats strapped on", "their arms and armour",
        "who has what equipped", "the loadout of the party", "everyones weapons and armour",
    ],
    "buy": [
        "pick up a {item}", "grab a {item}", "grab a couple of {item}", "get hold of a {item}",
        "we could use a {item}", "we need a {item}", "get some {item}", "stock up on {item}",
        "put money down for a {item}", "spend some coin on a {item}", "invest in a {item}",
        "a {item} would be useful", "add a {item} to the packs", "secure a {item}",
    ],
    "sell": [
        "flog the {item}", "shift the {item}", "unload the {item}", "trade in the {item}",
        "turn the {item} into coin", "cash in the {item}", "get rid of the {item}",
        "we dont need the {item} any more", "part with the {item}", "sell on the {item}",
        "put the {item} up for sale", "clear out the {item}",
        # Selling naturally mentions where it happens, which must not read as
        # a plain request to open the shop.
        "sell the {item} at the market", "flog the {item} at the market",
        "offload the {item} at the shop", "take the {item} to the market and sell it",
        "sell the {item} to the merchant", "get the market to take the {item}",
        "see what the merchant gives for the {item}", "trade the {item} in at the shop",
    ],
    "talk_to": [
        "have a word with {npc}", "pay {npc} a visit", "go see {npc}", "call on {npc}",
        "look {npc} up", "catch up with {npc}", "check in with {npc}", "put a question to {npc}",
        "hear what {npc} has to say", "see what {npc} knows", "get {npc} talking",
        "strike up a conversation with {npc}", "introduce yourselves to {npc}", "seek out {npc}",
    ],
    "travel_to": [
        "set a course for {dest}", "point them at {dest}", "get them over to {dest}",
        "aim for {dest}", "head for {dest}", "make your way to {dest}", "strike out for {dest}",
        "take the road to {dest}", "the road to {dest}", "we are going to {dest}",
        "get on the road to {dest}", "cross to {dest}", "push on to {dest}", "carry on to {dest}",
    ],
    "summon": [
        "drop a {monster} on them", "send a {monster} at them", "throw a {monster} in their path",
        "spring a {monster} on them", "put a {monster} in front of them", "have a {monster} show up",
        "let a {monster} find them", "a {monster} appears", "a {monster} blocks their way",
        "surprise them with a {monster}", "give them a {monster} to deal with", "set a {monster} on them",
        "a {monster} comes out of the dark", "confront them with a {monster}", "ambush them with a {monster}",
        "send a pack of {monster} after them", "i want a {monster} attacking them",
    ],
    "search_traps": [
        "sweep the floor ahead", "check the ground", "look the floor over", "is it safe to walk",
        "anything rigged around here", "anything dangerous underfoot", "check this stretch",
        "have the rogue go ahead and look", "get the rogue checking", "someone look for tripwires",
        "test the flagstones", "probe the floor", "make sure the way is safe", "any nasty surprises here",
        "sweep the corridor ahead", "check the hallway over",
    ],
    "disarm_trap": [
        "make it safe", "shut it down", "get rid of it", "deal with that thing", "sort that trap out",
        "have the rogue handle it", "spike the mechanism", "jam the mechanism", "render it harmless",
        "take care of the trap", "unhook the wire", "wedge it shut", "put that trap out of action",
        "get it defused", "defuse the thing before someone gets hurt",
    ],
    "quests": [
        "anything posted", "any work going", "any jobs about", "whats on the notice board",
        "see if theres work", "check what needs doing", "is anyone hiring", "any commissions",
        "what needs doing round here", "look for work", "any bounties up", "read the board",
    ],
    "turn_in_quest": [
        "collect what were owed", "get paid", "claim whats ours", "report back and get paid",
        "go and settle up", "collect the fee", "take the proof back", "close out the job",
        "finish the paperwork", "get our money", "tell them its done",
    ],
    "upcast": [
        "burn the biggest slots {policy}", "spend the high slots {policy}", "hold the big spells back {policy}",
        "save the high slots {policy}", "casting doctrine {policy}", "let the casters go {policy}",
        "big spells {policy}", "high level slots {policy}", "spell economy {policy}",
        "the casters should upcast {policy}", "tell the casters {policy} on the big slots",
    ],
    "descend": [
        "further underground", "one floor lower", "the next level down", "deeper in",
        "get lower", "work your way down", "find a way down", "look for a way down",
        "down another level", "into the lower halls", "the level below", "carry on downwards",
    ],
    "go_to_town": [
        "back to civilisation", "somewhere safe", "back behind walls", "back to the village",
        "find a settlement", "get indoors somewhere", "back where its warm", "make for safety",
        "return to a settlement", "get them off the road", "back among people", "behind town walls",
    ],
    "depart_town": [
        "out of town", "get on the road", "back on the road", "leave the walls behind",
        "weve been here long enough", "no more dawdling", "the road is waiting",
        "put the town behind you", "away from here", "back to the wilds",
    ],
    "long_rest": [
        "bed down here", "pitch the tents", "sleep till morning", "call it a night",
        "get your heads down", "sleep properly", "a full nights rest", "rest until sunrise",
        "stop for the night", "we go on in the morning", "turn in for the night",
    ],
    "short_rest": [
        "a quick breather", "just a short break", "sit down for a minute", "a moment to recover",
        "see to the wounded", "patch up quickly", "get your breath back", "a brief halt",
        "pause and recover", "rest your legs", "a short stop",
    ],
    "use_item": [
        "crack open a {potion}", "pop a {potion}", "break out the {potion}", "get a {potion} into someone",
        "someone take a {potion}", "use up a {potion}", "burn a {scroll}", "let off the {scroll}",
        "unroll the {scroll}", "trigger the {scroll}", "someone drink something",
    ],
    "equip": [
        "get the {gear} on", "strap the {gear} on", "buckle on the {gear}", "kit out with the {gear}",
        "someone take the {gear}", "put the {gear} to use", "the {gear} goes on {member}",
        "hand the {gear} to {member}", "{member} takes the {gear}", "get the {gear} into someones hands",
    ],
    "unequip": [
        "get the {gear} off", "shed the {gear}", "drop the {gear}", "pack the {gear} away",
        "no more {gear}", "take that {gear} off", "lose the {gear}", "set the {gear} aside",
    ],
    "list_npcs": [
        "names of the locals", "anyone worth talking to", "whos worth meeting", "who might help",
        "who lives round here", "point out the locals", "any faces of note", "the people of this town",
    ],
    "list_clues": [
        "what leads do we have", "what do we know about the bandits", "our bandit intelligence",
        "the leads on the hideouts", "what intelligence do we hold", "any leads",
    ],
    "shop": [
        "see what the stalls have", "have a wander round the market", "look over the goods",
        "browse what they sell", "check the shelves", "see whats on offer", "peruse the stock",
        "look at the stalls", "visit the traders", "check out the wares",
    ],
    "journal": [
        "read back what weve done", "recap the adventure", "remind me what has happened",
        "go over our history", "the record of our deeds", "what have we been through",
        "run through the log", "our deeds so far", "the tale so far",
    ],
    "search_room": [
        "turn this room over", "go through this room", "comb the room", "have a proper look round",
        "check every corner", "poke around in here", "give the room a going over", "sweep the room",
    ],
    "help": [
        "what can i tell them to do", "what orders can i give", "remind me of the commands",
        "how do i order them about", "what am i allowed to say", "list what you understand",
    ],
    "raid_camp": [
        "hit the bandits hard", "go after the bandits", "wipe out the camp", "burn the camp down",
        "clear the hideout out", "put the camp to the torch", "descend on the camp",
    ],
    "report_camp": [
        "hand the map over to the constable", "tell the guard where the bandits are",
        "pass the location to the authorities", "let the watch know about the hideout",
        "take the camp location to town", "turn the bandits in",
    ],
    "feature_treasure": [
        "clean the place out", "take every coin", "empty the room", "strip it bare",
        "load up on the treasure", "scoop up everything", "take the lot",
    ],
    "feature_vault": [
        "get the vault open", "get that vault emptied", "crack it open", "empty the strongbox",
        "force the vault", "clear out the vault",
    ],
    "feature_prison": [
        "let those poor souls out", "get the captives out", "unlock them", "set them loose",
        "cut them free", "get those people out of there",
    ],
    "feature_library": [
        "let the wizard at the books", "bury yourselves in the tomes", "go through the shelves",
        "study everything here", "look through the collection",
    ],
    "feature_forge": [
        "put an edge on the blades", "get the weapons sharpened", "make use of the anvil",
        "grind the blades", "see to the weapons at the forge",
    ],
    "feature_sarcophagus": [
        "get the lid off", "prise it open", "force the tomb", "shift the stone lid",
        "heave the coffin open",
    ],
    "feature_chokepoint": [
        "block that passage up", "throw up a barricade", "wall it off", "seal the gap",
        "stack something across it", "make a stand here",
    ],
    "feature_puzzle": [
        "have a crack at that mechanism", "work out the mechanism", "figure the puzzle out",
        "line the symbols up", "get the puzzle solved", "let the wizard try it",
    ],
    "feature_war_room": [
        "pore over the battle maps", "read the plans", "make sense of the maps",
        "study what they left behind", "go over the war table",
    ],
    "feature_merchant_talk": [
        "see what the trader is selling", "hear the merchant out", "do business with him",
        "ask what he has", "have a look at his stock",
    ],
    "feature_merchant_rob": [
        "take his goods by force", "help yourselves to his stock", "relieve him of his cart",
        "turn on the trader", "strip his cart",
    ],
    "tasks": [
        "small work going", "anything on the board", "the odd jobs list", "minor work available",
        "whats posted on the small board", "casual work", "day labour going",
    ],
    "accept_task": [
        "put us down for the task", "we will handle that notice", "take that small job",
        "claim task {qidx}", "add task {qidx} to our list", "sign on for the odd job",
    ],
    "feature_chest": [
        "get it open", "prise the lid up", "jimmy the lid", "wrench the chest open",
        "see what the chest holds", "turn the chest out", "empty it out",
        "let the rogue at the lock", "force it open", "check whats inside",
    ],
    "unknown": [
        "that was hairy", "i wasnt expecting that", "these dice hate me", "the wizard is useless",
        "i hope they make it", "not looking good", "brutal", "unlucky", "typical", "of course",
        "that could have gone better", "she nearly died there", "he took a beating",
        "how many floors are there", "how long does a delve take", "whats the deepest anyone has gone",
        "do monsters respawn", "is there a boss down here", "what happens if they all die",
        "the crypts sound dangerous", "i heard the mines are haunted", "the road north is bandit country",
        "the smith drives a hard bargain", "the tavern looked cosy", "that shrine gave me the creeps",
        "i like the rogue", "the paladin is my favourite", "good party this",
        "creepy place this", "grim down here", "this is going well", "poor thing has had a rough day",
        "lovely weather", "no idea what to do next", "remind me why we came here",
    ],
}

# fmt: on
