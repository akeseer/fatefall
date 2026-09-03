"""
Paraphrase templates for every DM intent.

Each intent maps to a list of template strings. Placeholders in braces are
filled by gen_data.py from vocab.json and the small pools below:

  {dir}        north / south / east / west and their short/long forms
  {dice}       a dice expression like 2d6+3
  {slot}       1..3            {qidx}  1..4
  {monster}    a monster name  {npc}   a quest-giver / townsperson name
  {potion} {scroll} {gear} {item}      item names
  {dest}       a town or dungeon-entrance name
  {name}       a fresh character/party name
  {member}     a party member's first name
  {policy}     always / never / auto  (upcast)
  {time}       dawn / dusk / night wording
  {formation}  2x2 / line / loose / ...

Registers: imperative, polite, terse, collective ("everyone", "party",
"let's"), and DM-voice ("the party ..."). Keep templates honest: a template
must clearly mean its intent to a human reader, because the regex labeller
will flag anything ambiguous and we review those by hand.
"""

# fmt: off

DIRS = {
    "north": ["north", "n", "northward", "northwards", "up north", "to the north", "up"],
    "south": ["south", "s", "southward", "southwards", "down south", "to the south", "down"],
    "east":  ["east", "e", "eastward", "eastwards", "to the east", "right"],
    "west":  ["west", "w", "westward", "westwards", "to the west", "left"],
}

# Every wording here must survive timeTarget() in DMCommandParser.ts, which reads
# dusk from /dusk|evening/, night from /night|midnight|dark/ and takes dawn as the
# default. So a dawn wording must contain none of those words, and a dusk wording
# must say "dusk" or "evening" outright — "twilight" would silently label as dawn.
TIMES = {
    "dawn":  ["dawn", "morning", "daylight", "day", "first light", "sunrise", "sunup", "sun up",
              "the sun comes up", "the sun is up", "the sun rises", "daybreak", "break of day",
              "it gets light", "the light comes back", "morning light", "first thing", "cockcrow"],
    "dusk":  ["dusk", "evening", "sundown", "sunset", "dusk falls", "evening falls", "evening comes",
              "early evening", "the evening", "dusk proper", "evening light"],
    "night": ["night", "nightfall", "midnight", "dark", "full dark", "it gets dark", "dark falls",
              "night falls", "after dark", "the dead of night", "properly dark", "the small hours of the night"],
}

POLICIES = {
    "always": ["always", "max", "maximum", "all", "always upcast"],
    "never":  ["never", "off", "none", "no"],
    "auto":   ["auto", "automatic", "when needed", "as needed", "normal"],
}

FORMATIONS = ["2x2", "1x4", "2x3", "3x1", "line", "column", "single file", "block", "square", "loose", "wide", "spread", "4x1", "2 x 2"]

FILLER_PREFIX = ["", "", "", "", "ok", "okay", "alright", "alright then", "right,", "now", "please", "everyone,", "party,", "hey", "so", "um", "well", "fine,", "quickly,", "quietly,", "DM:", "listen up -"]
FILLER_SUFFIX = ["", "", "", "", "please", "now", "!", ".", "...", "thanks", "if you would", "right away", "at once", "when ready", "ok?", "please and thank you", "everyone", "all of you", "team"]

# Conversational frames wrapped around bare imperative orders. People rarely
# type "search the vault"; they type "i want you to search the vault". The
# model has to learn that the carrier is noise and the core carries the intent.
CARRIERS = [
    "i want you to {}", "i want them to {}", "i'd like you to {}", "i need you to {}",
    "could you {}", "could you all {}", "can you {}", "can someone {}", "would you {}",
    "please {}", "just {}", "go and {}", "go {}", "now {}", "quickly {}",
    "tell them to {}", "have them {}", "have the party {}", "get them to {}", "get everyone to {}",
    "everyone {}", "everybody {}", "party, {}", "lads, {}", "all of you, {}",
    "let's {}", "lets {}", "we should {}", "you should {}", "they should {}", "we need to {}",
    "i think you should {}", "i reckon you should {}", "how about you {}", "why don't you {}", "maybe {}",
    "make sure you {}", "see that you {}", "be sure to {}", "don't forget to {}",
    "the party will {}", "the party should {}", "they need to {}", "time to {}", "it's time to {}",
    "right, {}", "ok now {}", "alright, {}", "listen, {}", "first things first, {}",
    "next, {}", "after that, {}", "before anything else, {}", "when you can, {}", "at your leisure, {}",
    "i'd rather you {}", "what i want is for you to {}", "my order is simple - {}",
]

# A template is only wrapped when it reads as a bare command. These sentence
# openers mark questions and statements, which carriers would mangle.
NON_IMPERATIVE_OPENERS = {
    "what", "whats", "what's", "who", "whos", "who's", "which", "how", "where", "when", "why",
    "is", "are", "was", "were", "do", "does", "did", "can", "could", "would", "should", "will",
    "any", "anything", "i", "im", "i'm", "we", "our", "this", "that", "it", "there", "the", "a", "an",
    "?", "help", "yes", "no", "hello", "hi", "good", "nice", "cool", "wow", "lol", "hmm", "okay", "ok",
    "asdf", "qwerty", "zxcv", "lkjh", "blah", "test", "testing", "123", "???", "!!!", "...", "once",
    "roll", "beware", "trust", "there", "north", "poor", "god",
}


def is_imperative(template: str) -> bool:
    """Cheap check that a template reads as a bare order, so a carrier fits."""
    first = template.strip().lower().split(" ")[0].strip(",.!?")
    if first in NON_IMPERATIVE_OPENERS:
        return False
    return len(template.split(" ")) <= 8 and not template.startswith("{")

T = {}

# ── meta ────────────────────────────────────────────────────────────────────
T["help"] = [
    "help", "?", "help me", "what can i say", "what commands are there", "list commands", "show commands",
    "what orders do you understand", "how do i play", "what can the party do", "commands", "instructions",
    "i need help", "what should i type", "show me the orders", "give me the list of orders", "help please",
]
T["pause"] = [
    "pause", "hold", "pause the game", "hold on", "wait a moment", "stop for a second", "freeze", "hold everything",
    "pause everything", "time out", "stop the clock", "hold up a sec", "halt", "hold position", "stay put for now",
    "nobody move", "stop right there", "give me a second", "pause please", "hold it",
]
T["resume"] = [
    "resume", "unpause", "carry on", "as you were", "continue", "go on", "keep going", "proceed", "back to it",
    "resume the game", "carry on exploring", "continue as normal", "back to normal", "you're free to act",
    "do as you see fit", "use your own judgment", "forget my orders", "cancel my orders", "stand down and carry on",
    "at ease, carry on", "keep exploring", "resume exploring",
]
T["save"] = [
    "save", "save game", "save the game", "quicksave", "quick save", "checkpoint", "save our progress", "save now",
    "save to slot {slot}", "save in slot {slot}", "save slot {slot}", "save {slot}", "write a checkpoint",
    "make a save", "record our progress", "persist the run", "save this run", "save it", "please save",
    "put this in slot {slot}", "save everything",
]
T["new_game"] = [
    "new game", "new run", "start over", "restart", "fresh start", "abandon this run", "wipe the save", "erase it all",
    "begin again", "start a new adventure", "scrap this party and start fresh", "reset everything", "start from scratch",
    "abandon", "wipe", "restart the game", "new adventure", "roll a new party", "start a fresh run",
]
T["model_toggle"] = [
    "model on", "model off", "model status", "model", "dm model on", "dm model off", "dm model status",
]
T["rename_party"] = [
    "rename party {name}", "rename the party {name}", "name the party {name}", "party name {name}", "name party {name}",
    "call the party {name}", "the party shall be known as {name}", "our party is called {name}", "we are the {name}",
    "let's call ourselves {name}", "rename party", "give the party a new name", "pick a new party name",
    "name our company {name}", "our band is {name}", "rename the party to {name}", "call us {name}",
]
T["rename_member"] = [
    "rename {member} to {name}", "rename {member} as {name}", "rename character {member} to {name}",
    "call {member} {name} from now on", "{member} is now called {name}", "change {member}'s name to {name}",
    "{member} shall be known as {name}", "let's rename {member} to {name}", "rename {member} {name}",
    "give {member} the name {name}", "{member} will go by {name}",
]

# ── observation ─────────────────────────────────────────────────────────────
T["look"] = [
    "look", "look around", "examine", "survey", "inspect", "describe the room", "describe room", "what do we see",
    "what's around us", "where are we", "describe our surroundings", "take a look around", "what does it look like here",
    "tell me about this place", "paint the scene", "set the scene", "describe the area", "look about", "have a look",
    "what's here", "scan the room", "what do i see", "describe where we are", "show me the room",
]
T["report"] = [
    "report", "status", "sitrep", "how goes", "party status", "how is everyone", "how are we doing", "give me a status report",
    "how's the party", "health check", "what's our condition", "who is hurt", "how's everyone holding up", "state of the party",
    "how bad is it", "report in", "status report", "tell me how everyone is", "check on the party", "what's our status",
    "any wounded", "casualty report", "how are the others", "are we alright",
]
T["calendar"] = [
    "what day is it", "calendar", "date", "today", "whats today", "what's the date", "what day", "what is the moon phase",
    "is it a full moon", "what's the weather and date", "which day of the week is it", "what season is it", "tell me the date",
    "what's on the calendar", "any festivals today", "is today special", "what's the moon doing", "moon phase",
    "how's the moon tonight", "what's the day today",
]
T["journal"] = [
    "journal", "chronicle", "history", "ledger", "story", "log", "read the journal", "open the chronicle", "our story so far",
    "what have we done", "recap our adventures", "show the log", "read back our deeds", "journal page 2", "chronicle of combat",
    "journal moon", "journal quests", "show me the history", "what happened so far", "read the chronicle", "tell our tale",
    "journal loot", "journal page 3", "the story so far",
]
T["inventory"] = [
    "loot", "inventory", "pack", "gear", "what do we carry", "what are we carrying", "show inventory", "what's in the pack",
    "check our packs", "what loot do we have", "list our items", "open the bags", "what have we got", "show me the loot",
    "what treasure do we have", "how much gold do we have", "count the gold", "check the bags", "what supplies do we have",
    "empty the packs", "what are we hauling", "show our stuff", "items", "what's in our bags",
]
T["gear"] = [
    "equipment", "loadout", "what are we wearing", "what is everyone wielding", "show equipped items", "show equipment",
    "who's wearing what", "list our armor and weapons", "what weapons are equipped", "show the loadout", "equipped gear",
    "what's everyone armed with", "check our armor", "show what we have equipped", "arms and armor", "what's equipped",
]

# ── movement / stance ───────────────────────────────────────────────────────
T["move"] = [
    "go {dir}", "head {dir}", "move {dir}", "walk {dir}", "march {dir}", "travel {dir}", "venture {dir}", "continue {dir}",
    "{dir}", "{dir}!", "{dir}.", "everyone {dir}", "let's go {dir}", "take the party {dir}", "push {dir}", "press {dir}",
    "lead them {dir}", "head off {dir}", "make your way {dir}", "proceed {dir}", "turn {dir}", "we go {dir}",
    "go {dir} now", "keep heading {dir}", "the party marches {dir}", "the party heads {dir}", "set off {dir}",
    "swing {dir}", "bear {dir}", "strike out {dir}", "could you all head {dir}", "have everyone push {dir}",
    "i want you to go {dir}", "let's try {dir}", "explore {dir}", "follow the passage {dir}", "take the {dir} passage",
    "go {dir} and keep going", "double back {dir}", "{dir}, quickly", "{dir} please",
]
T["stance:aggressive"] = [
    "attack", "fight", "charge", "hunt", "kill", "to arms", "onward", "attack!", "charge!", "kill them all", "fight everything",
    "hunt them down", "go on the offensive", "seek out enemies", "engage anything you find", "be aggressive", "no mercy",
    "weapons out", "hunt for monsters", "look for a fight", "pick a fight", "engage the enemy", "go hunting",
    "take the fight to them", "hunt anything that moves", "attack on sight", "be bold, fight them", "we fight",
    "let's fight", "draw steel", "get them", "kill everything", "chase them down", "hunt the goblins",
]
T["stance:cautious"] = [
    "flee", "retreat", "avoid", "careful", "cautious", "sneak", "evade", "withdraw", "stealth", "be careful", "avoid fights",
    "stay out of trouble", "don't fight", "avoid the monsters", "keep your heads down", "go quietly", "sneak past everything",
    "no fighting", "stay safe", "play it safe", "be cautious", "steer clear of enemies", "back off", "pull back",
    "fall back", "run away", "avoid combat", "slip past them", "keep quiet and avoid them", "stealth mode", "be sneaky",
    "tread carefully", "caution, everyone", "discretion over valor", "hide from them",
]
T["formation"] = [
    "formation {formation}", "formation as {formation}", "formation into {formation}", "form up {formation}", "reform into {formation}",
    "get into {formation} formation", "take {formation} formation", "adopt a {formation} formation", "form a {formation}",
    "{formation} formation", "move in {formation}", "walk in {formation}", "spread into {formation}",
]
T["formation_help"] = [
    "formation", "form up", "reform", "shape", "what formations are there", "change formation", "which formations can we use",
    "formation options", "show formations", "list formations", "reform the party", "get into formation",
]
T["descend"] = [
    "descend", "deeper", "next floor", "downstairs", "stairs down", "take the stairs", "go down a level", "go deeper",
    "head down to the next floor", "find the stairs and descend", "next level", "take us deeper", "down we go", "go down the stairs",
    "let's go deeper", "delve deeper", "press on to the next floor", "find the way down", "further down", "keep descending",
    "descend to the next level", "onward and downward", "to the next floor", "seek the stairs down", "drop down a floor",
]
T["leave_dungeon"] = [
    "leave", "ascend", "climb out", "surface", "get out", "exit the dungeon", "leave the dungeon", "go back up", "head to the surface",
    "get out of here", "climb back out", "return to the surface", "we're done here, get out", "abandon the delve", "back to daylight",
    "exit", "let's get out of this dungeon", "up and out", "leave this place", "go up to the surface", "climb out of the dungeon",
]
T["enter_dungeon"] = [
    "enter", "delve", "descend into the dungeon", "go into the dungeon", "enter the dungeon", "go in", "head inside", "into the depths",
    "begin the delve", "enter the ruins", "go into the crypt", "step inside", "let's go in", "enter the entrance", "start the delve",
    "go underground", "into the dungeon we go", "take the party inside", "enter the delve", "delve in",
]
T["depart_town"] = [
    "leave town", "depart", "set out", "hit the road", "take the road", "ride out", "head out", "let's leave town", "depart town",
    "we're leaving", "move out", "leave this town", "get on the road", "time to go", "set out from town", "leave the village",
    "onward from here, leave town", "let's hit the road", "head out of town", "pack up and depart", "depart the town",
]
T["go_to_town"] = [
    "go to town", "return to town", "back to town", "head home", "go home", "return home", "go back to town", "let's return to town",
    "head back to town", "make for town", "return to the village", "back to the village", "go back home", "head for home",
    "take us back to town", "we need to get back to town", "let's go home", "return to civilization", "head to the nearest town",
    "go find a town",
]
T["travel_to"] = [
    "travel to {dest}", "head to {dest}", "make for {dest}", "bound for {dest}", "trek to {dest}", "go to {dest}", "walk to {dest}",
    "journey to {dest}", "march to {dest}", "set out for {dest}", "set course for {dest}", "let's go to {dest}", "take us to {dest}",
    "head toward {dest}", "head towards {dest}", "we're going to {dest}", "travel towards {dest}", "make our way to {dest}",
    "onward to {dest}", "next stop {dest}", "path to {dest}", "find {dest}", "go find {dest}", "lead us to {dest}",
]

# ── time / rest ─────────────────────────────────────────────────────────────
T["wait_until"] = [
    "wait until {time}", "wait for {time}", "wait out the {time}", "wait till {time}", "bide until {time}", "sit tight until {time}",
    "pass the time until {time}", "hold up until {time}", "wait here until {time}", "let's wait for {time}", "wait for the {time}",
    "bide your time until {time}", "sit tight till {time}", "wait it out until {time}", "hold until {time}", "wait out until {time}",
]
T["long_rest"] = [
    "long rest", "camp", "make camp", "set up camp", "camp here", "take a long rest", "sleep", "rest for the night", "bed down",
    "camp for the night", "pitch camp", "let's camp", "we camp here", "settle in for a long rest", "full rest", "sleep it off",
    "make camp and rest", "rest until morning", "camp out", "long rest here", "take the night", "get some sleep", "we need a long rest",
]
T["short_rest"] = [
    "rest", "recover", "catch breath", "catching breath", "bind wounds", "take a breather", "short rest", "take a short rest",
    "rest a moment", "patch yourselves up", "catch your breath", "quick rest", "rest up", "take five", "breathe for a moment",
    "tend the wounded", "bandage up", "a quick rest", "rest here briefly", "recover a bit", "take a short break", "rest for a bit",
    "let's rest", "everyone rest",
]

# ── dice / magic ────────────────────────────────────────────────────────────
T["roll"] = [
    "roll {dice}", "roll {dice} adv", "roll {dice} dis", "roll a {dice}", "roll {dice} for me", "roll {dice} please",
    "roll {dice} with advantage", "roll {dice} with disadvantage", "roll d20", "roll a d20", "roll the dice {dice}", "roll {dice}!",
]
T["upcast"] = [
    "upcast {policy}", "upcast policy {policy}", "set upcast to {policy}", "upcasting {policy}", "upcast: {policy}", "upcast",
    "casters upcast {policy}", "upcast {policy} please", "spell upcasting {policy}", "upcast spells {policy}",
]
T["summon"] = [
    "summon {monster}", "conjure {monster}", "spawn {monster}", "summon a {monster}", "summon an {monster}", "conjure a {monster}",
    "spawn a {monster}", "call forth a {monster}", "summon the {monster}", "bring forth a {monster}", "manifest a {monster}",
    "summon {monster}!", "let a {monster} appear", "spawn {monster} now", "conjure up a {monster}", "throw a {monster} at them",
    "send a {monster} against the party", "have a {monster} attack", "unleash a {monster}", "summon a {monster} to fight them",
]

# ── traps ───────────────────────────────────────────────────────────────────
T["search_traps"] = [
    "search for traps", "search", "look for traps", "find traps", "scan for traps", "check for traps", "any traps here",
    "check the floor for traps", "look out for traps", "sweep for traps", "detect traps", "search the area for traps", "trap check",
    "are there traps", "watch for traps", "search for hidden traps", "scan the corridor for traps", "search carefully for traps",
    "is this floor trapped", "check for tripwires", "look for pressure plates", "search for hazards",
]
T["disarm_trap"] = [
    "disarm", "disarm trap", "disarm the trap", "disable the trap", "defuse the trap", "spring the trap", "disarm that trap",
    "disable it", "defuse it", "deal with the trap", "get rid of the trap", "disarm the hazard", "neutralize the trap",
    "disarm the pressure plate", "cut the tripwire", "disarm the traps", "make the trap safe", "have the rogue disarm the trap",
    "disarm it carefully", "disable the mechanism",
]

# ── items ───────────────────────────────────────────────────────────────────
T["use_item"] = [
    "use {potion}", "drink {potion}", "quaff {potion}", "drink a {potion}", "use a {potion}", "read {scroll}", "cast {scroll}",
    "read the {scroll}", "use the {scroll}", "use {potion} on {member}", "drink {potion} on {member}", "give {member} a {potion}",
    "have {member} drink a {potion}", "{member} drinks a {potion}", "read {scroll} now", "quaff a {potion} quickly",
    "use a {potion} on the most wounded", "drink the {potion}", "cast the {scroll}", "apply {potion}", "sip a {potion}",
    "swig a {potion}", "use {potion} on the leader",
]
T["equip"] = [
    "equip {gear}", "wield {gear}", "don {gear}", "wear {gear}", "put on {gear}", "equip the {gear}", "wield the {gear}",
    "equip {gear} on {member}", "have {member} wield the {gear}", "{member} equips the {gear}", "put the {gear} on {member}",
    "wear the {gear}", "don the {gear}", "equip a {gear}", "arm {member} with the {gear}", "let {member} wear the {gear}",
    "give {member} the {gear} to wield", "strap on the {gear}", "ready the {gear}",
]
T["unequip"] = [
    "unequip {gear}", "remove {gear}", "doff {gear}", "stow {gear}", "unequip the {gear}", "remove the {gear}", "take off the {gear}",
    "stow the {gear}", "unequip armor", "unequip weapon", "remove the shield", "doff the armor", "put away the {gear}",
    "unequip the shield", "sheathe the {gear}", "take off {gear}", "remove {member}'s {gear}", "have {member} remove the {gear}",
    "doff the {gear}", "unequip trinket",
]

# ── town / quests / commerce ────────────────────────────────────────────────
T["quests"] = [
    "quests", "quest board", "postings", "contracts", "show quests", "what quests are there", "list the quests", "any work available",
    "check the quest board", "what jobs are posted", "show me the postings", "available contracts", "what's on the board",
    # "notice board" belongs to `tasks` in the regex cascade, so it must not
    # appear here: the two classes had this same template and it was pure noise.
    "read the quest board", "quest list", "any quests", "what work is there", "show the contracts", "look at the quest board",
    "what postings are up",
]
T["accept_quest"] = [
    "accept quest {qidx}", "accept the quest", "take the quest", "take on the job", "pick up the contract", "accept job {qidx}",
    "take quest {qidx}", "accept the posting", "we'll take the job", "accept contract {qidx}", "accept posting {qidx}",
    "take on quest {qidx}", "let's take quest {qidx}", "take the first quest", "accept the first job", "we accept the contract",
    "sign us up for quest {qidx}", "take the second quest", "accept the second job", "accept quest number {qidx}",
    "accept the job", "take that quest", "we'll do quest {qidx}", "accept",
]
T["tasks"] = [
    "tasks", "task board", "bulletin board", "bulletin", "notice board", "odd jobs",
    "check the bulletin board", "whats on the bulletin board", "read the notice board",
    "any odd jobs about", "show the task board", "what small work is posted",
    "look at the notices", "see the bulletin", "list the tasks", "what tasks do we have",
    "our board work", "whats pinned up", "check the notices", "any small jobs",
    "show me the odd jobs", "what have we taken on", "board work in hand",
]
T["accept_task"] = [
    "accept task {qidx}", "take task {qidx}", "take on the task", "pick up the notice",
    "accept the bulletin", "sign up for task {qidx}", "well take that task",
    "take the odd job", "accept notice {qidx}", "take on task {qidx}", "accept that notice",
    "put our name to task {qidx}", "we will take task {qidx}", "take the task",
    "accept the notice", "take on the bulletin", "we accept the task", "take job {qidx} from the board",
]

T["turn_in_quest"] = [
    "turn in", "turn in the quest", "complete quest", "claim reward", "hand in", "hand in the quest", "report the quest complete",
    "collect our reward", "turn in the contract", "claim our reward", "finish the quest", "turn the quest in", "report success",
    "hand in the contract", "let's claim the reward", "turn in the job", "cash in the quest", "collect the bounty", "quest complete, claim it",
    "claim the quest reward",
]
T["shop"] = [
    "shop", "market", "store", "trade", "merchant", "open the shop", "go to the market", "visit the store", "let's go shopping",
    "browse the market", "see what's for sale", "open the market", "check the shop", "visit the merchant", "what's for sale",
    "go shopping", "browse the wares", "show the market", "open the store", "let's trade", "see the merchant", "check the market stalls",
]
T["buy"] = [
    "buy {item}", "buy a {item}", "buy {item} please", "purchase {item}", "purchase a {item}", "buy the {item}", "get a {item}",
    "buy some {item}", "buy two {item}", "let's buy a {item}", "acquire a {item}", "buy {item} from the shop", "pick up a {item}",
    "buy us a {item}", "we should buy a {item}", "purchase the {item}", "buy one {item}", "buy {item} now",
]
T["sell"] = [
    "sell {item}", "sell the {item}", "sell a {item}", "sell our {item}", "sell {item} please", "offload the {item}", "hawk the {item}",
    "pawn the {item}", "sell off the {item}", "let's sell the {item}", "sell that {item}", "get rid of the {item} at the shop",
    "sell {item} to the merchant", "sell some {item}", "sell the spare {item}", "trade in the {item}",
]
T["talk_to"] = [
    "talk to {npc}", "speak to {npc}", "visit {npc}", "greet {npc}", "meet {npc}", "chat with {npc}", "talk with {npc}", "speak with {npc}",
    "go see {npc}", "find {npc}", "let's talk to {npc}", "have a word with {npc}", "ask {npc} for work", "see what {npc} wants",
    "approach {npc}", "talk to the {npc}", "speak to the {npc}", "go talk to {npc}", "meet with {npc}", "say hello to {npc}",
    "visit the {npc}", "greet the {npc}", "call on {npc}",
]
T["list_npcs"] = [
    "list npcs", "who is here", "who's here", "townspeople", "people", "citizens", "who lives here", "who can we talk to",
    "who's in town", "list the townsfolk", "any notable people here", "who's around", "show me the locals", "who is in this town",
    "list the locals", "who are the npcs", "who might have work", "the townsfolk", "show the townspeople", "who's about",
]
T["raid_camp"] = [
    "raid camp", "assault camp", "attack camp", "hit the camp", "storm the camp", "raid the camp", "raid the bandit camp",
    "attack the bandit camp", "storm the bandit camp", "assault the hideout", "raid the hideout", "hit the bandit camp",
    "let's raid the camp", "go raid the camp", "attack the hideout", "raid the bandits", "assault the bandit camp", "raid their camp",
    "storm their hideout", "hit their camp",
]
T["report_camp"] = [
    "report camp", "report hideout", "report bandits", "report to constable", "report the camp", "report the bandit camp",
    "tell the constable about the camp", "report the hideout to the constable", "report the bandits to the guard", "hand the map to the constable",
    "report the camp location", "turn in the camp clue", "inform the constable", "report the bandit hideout", "give the constable the map",
    "report the camp to the constable", "let the constable know about the camp", "report our clue",
]
T["list_clues"] = [
    "list clues", "clues", "maps", "bandit maps", "camp clues", "show the clues", "what clues do we have", "any camp clues",
    "show the bandit maps", "list the maps", "do we have any clues", "check our clues", "what maps do we hold", "show camp clues",
    "list bandit clues", "what hideouts do we know of", "clues to bandit camps", "our clues", "show me the maps",
]

# ── room features (generated only with the matching featureKind) ────────────
T["feature_altar"] = [
    "pray at the altar", "pray", "kneel", "kneel at the altar", "bless us at the shrine", "make an offering", "offer a prayer",
    "pray to the gods", "kneel before the shrine", "use the altar", "approach the altar and pray", "say a prayer", "bless the party",
    "kneel and pray", "leave an offering at the altar", "have the cleric pray at the altar", "pray at the shrine", "offer at the altar",
]
T["feature_vault"] = [
    "search the vault", "open the vault", "loot the vault", "rob the vault", "break open the vault", "open the strongbox",
    "search the strongbox", "loot the chest", "open the chest", "break into the vault", "search the treasure vault", "loot the treasure",
    "crack open the vault", "rob the strongbox", "open the treasure chest", "search the chest", "break the chest open",
]
T["feature_prison"] = [
    "free the prisoners", "release the prisoners", "rescue the prisoners", "open the cells", "free them", "release the captives",
    "rescue the captives", "unlock the cage", "open the cage", "free the prisoner", "let them out of the cell", "break open the cells",
    "rescue whoever is in the cage", "release the prisoner", "free whoever is locked up", "open the prison",
]
T["feature_chokepoint"] = [
    "barricade", "barricade the chokepoint", "fortify", "fortify the position", "brace", "hold the line", "blockade the passage",
    "build a barricade", "fortify the chokepoint", "barricade the door", "brace for attack", "block the passage", "set up a barricade",
    "hold the line here", "fortify here", "blockade",
]
T["feature_forge"] = [
    "use the forge", "sharpen the blades", "sharpen our weapons", "hone the blades", "use the whetstone", "forge", "sharpen",
    "hone our weapons", "work the forge", "sharpen everything", "put an edge on the weapons", "use the whetstone on our blades",
    "hone the swords", "sharpen the swords at the forge", "fire up the forge", "sharpen the axe",
]
T["feature_library"] = [
    "read the tomes", "read", "study", "study the books", "read the books", "search the library", "read the grimoire", "browse the tomes",
    "study the grimoire", "read a tome", "look through the books", "study the library", "read the scrolls on the shelves",
    "peruse the tomes", "read the shelves", "have the wizard study the tomes", "read something", "study the texts",
]
T["feature_fountain"] = [
    "drink from the fountain", "drink", "sip from the fountain", "drink the water", "sip", "drink from the cistern", "taste the water",
    "drink from the basin", "have a drink", "sip the water", "drink from the fountain everyone", "fill up at the fountain",
    "drink up", "sip from the cistern", "drink the fountain water",
]
T["feature_sarcophagus"] = [
    "open the sarcophagus", "pry open the sarcophagus", "break open the tomb", "open the coffin", "pry open the tomb", "open the tomb",
    "break the sarcophagus open", "pry the coffin open", "open the stone coffin", "break open the coffin", "open the sarcophagus lid",
    "pry open the lid of the tomb", "force the sarcophagus", "crack open the sarcophagus", "lift the sarcophagus lid",
]
T["feature_throne"] = [
    "approach the throne", "sit on the throne", "sit", "sit down on the throne", "take the throne", "sit in the throne", "examine the throne",
    "claim the throne", "have the leader sit on the throne", "sit upon the throne", "throne", "go sit on the throne", "rest on the throne",
    "someone sit on the throne", "let's try the throne",
]
T["feature_trapped_search"] = [
    "search the corridor", "check the corridor", "scan the passage", "find the traps here", "check the floor", "detect the traps",
    "search the passage", "scan the corridor", "check for the mechanism", "find the hazards", "detect the hazards", "search here carefully",
    "scan for the traps", "check this hallway", "search this corridor",
]
T["feature_trapped_disarm"] = [
    "disable the traps", "defuse the traps", "disable the mechanism", "defuse it", "disarm the corridor", "disable the trap here",
    "defuse the mechanism", "disarm them", "disable them", "defuse the corridor traps", "disable the hazards", "defuse everything here",
]
T["feature_treasure"] = [
    "search the treasure room", "loot the treasure room", "take the treasure", "grab the loot", "steal the treasure", "loot the room",
    "take everything", "grab the gold", "loot", "search the treasure", "take the gold", "open the coffers", "loot it all", "steal it all",
    "grab everything", "search the room for treasure", "rob the treasure room", "take the loot", "loot the hoard", "grab the coins",
]
T["feature_merchant_talk"] = [
    "talk to the merchant", "speak to the merchant", "trade with the merchant", "buy from the merchant", "greet the merchant", "hello merchant",
    "shop with the merchant", "see what the merchant has", "talk with the trader", "speak with the peddler", "hail the merchant",
    "browse the merchant's wares", "say hello to the merchant", "trade", "talk to him", "greet the trader", "buy something from him",
]
T["feature_merchant_rob"] = [
    "rob him", "rob the trader", "steal his goods", "attack the trader", "loot his cart", "rob him blind", "steal from him", "attack him",
    "take his goods by force", "rob the peddler", "steal the goods", "loot the cart", "attack the peddler", "rob the caravan",
    "steal his wares", "attack and rob him",
]
T["feature_puzzle"] = [
    "solve the puzzle", "solve it", "examine the puzzle", "study the puzzle", "rotate the dials", "align the symbols", "press the tiles",
    "activate the mechanism", "solve the riddle", "try the puzzle", "work the puzzle", "align the runes", "press the buttons", "rotate the rings",
    "study the mechanism", "have the wizard solve the puzzle", "attempt the puzzle", "solve the puzzle room", "activate the puzzle",
]
T["feature_ritual"] = [
    "examine the ritual circle", "use the ritual circle", "channel the ritual", "perform the ritual", "meditate in the circle", "pray in the circle",
    "cast in the ritual circle", "use the circle", "channel energy through the circle", "meditate", "perform a ritual", "summon power from the circle",
    "cast a spell in the circle", "use the ritual chamber", "conduct the ritual", "pray at the circle", "channel the chamber's power",
]
T["feature_chest"] = [
    "open the chest", "open it", "crack the chest", "force the lid", "pry the chest open",
    "get the chest open", "unlock the chest", "pick the lock", "lift the lid", "look inside the chest",
    "empty the chest", "loot the chest", "take whats in the chest", "open the coffer",
    "open the strongbox", "open the trunk", "get that trunk open", "see whats in it",
    "check the chest", "rifle the chest", "turn out the chest", "shift the lid",
    "break the chest open", "have the rogue pick it", "open the box",
]

T["feature_war_room"] = [
    "study the war table", "study the maps", "examine the maps", "look at the war table", "plan our strategy", "search the war room",
    "examine the war table", "study the strategy maps", "read the battle plans", "look over the maps", "study the plans", "examine the war room",
    "plan using the maps", "search the map room", "look at the maps", "study the battle map", "strategy",
]
T["feature_inspect"] = [
    "search", "investigate", "search the room", "investigate the room", "search around", "investigate the area", "search this place",
    "search here", "investigate this", "have a search", "search the chamber", "investigate the chamber",
]
T["search_room"] = [
    "search the room", "search the chamber", "search the area", "search here", "investigate", "investigate the room", "search this room",
    "investigate the area", "search this chamber", "investigate here", "search around the room", "investigate this place", "search the place",
]

# ── unknown: chatter, questions, lore, gibberish ────────────────────────────
T["unknown"] = [
    "hello", "hi there", "how are you", "good morning", "thanks", "thank you", "nice", "cool", "wow", "lol", "hmm", "okay then",
    "what is a beholder", "tell me about dragons", "who is the god of war", "what does fireball do", "explain armor class",
    "what's a saving throw", "how does initiative work", "is it going to rain", "what year is it", "tell me a joke", "sing a song",
    "i like this game", "this is fun", "you're doing great", "well done everyone", "good job", "that was close", "phew",
    "asdf", "qwerty", "zxcv", "lkjh", "asdf qwer", "blah blah", "test", "testing", "123", "???", "!!!", "...",
    "the weather is lovely", "a wizard did it", "once upon a time", "roll credits", "what happens next", "what should we do",
    "any advice", "what do you think", "i don't know", "maybe later", "not sure", "never mind", "forget it", "whatever",
    "tell me about the party", "who is the strongest", "what level are we", "how much longer", "are we there yet",
    "what's the meaning of life", "describe a dragon", "what's a mimic", "explain the rules", "what's the goal",
    "open the door", "close the door", "light a torch", "jump", "dance", "sing", "climb the wall", "swim", "fly",
    "cast fireball at the wall", "throw a rock", "shout", "whisper", "laugh", "cry", "eat", "cook dinner",
    "hello party", "greetings adventurers", "good luck", "be safe", "come back alive", "make me proud",
    "the goblin king is evil", "there be dragons", "beware the mimic", "trust no one", "the north is cold",
    "north is that way i think", "the vault was huge", "that merchant seemed shifty", "a camp would be nice someday",
]

# fmt: on

from vocabulary import EXTRA  # noqa: E402  (merged after T is defined)

for _key, _extra in EXTRA.items():
    assert _key in T, f"vocabulary.py has an entry for unknown template key {_key}"
    T[_key] = T[_key] + _extra

# Intents whose templates need a specific room feature in the sampled context.
FEATURE_FOR = {
    "feature_altar": "altar", "feature_vault": "vault", "feature_prison": "prison", "feature_chokepoint": "chokepoint",
    "feature_forge": "forge", "feature_library": "library", "feature_fountain": "fountain", "feature_sarcophagus": "sarcophagus",
    "feature_throne": "throne", "feature_trapped_search": "trapped_corridor", "feature_trapped_disarm": "trapped_corridor",
    "feature_treasure": "treasure_room", "feature_merchant_talk": "merchant_camp", "feature_merchant_rob": "merchant_camp",
    "feature_puzzle": "puzzle_room", "feature_ritual": "ritual_chamber", "feature_war_room": "war_room",
    "feature_chest": "chest",
}
