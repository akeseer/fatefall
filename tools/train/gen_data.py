"""
Generate the synthetic DM-order dataset.

  python tools/train/gen_data.py [--per-intent 2500] [--seed 7]

Reads  tools/train/data/vocab.json + intents.json (from `npm run export-vocab`)
Writes tools/train/data/train.jsonl and dev.jsonl

Rows: {"text", "intent", "ctx": {"featureKind", "inCombat", "mode"}, "template"}

The dev split holds out whole templates (10% per intent) so it measures
generalisation to unseen phrasings, not memorised fills.
"""
from __future__ import annotations

import argparse
import json
import random
import re
from collections import defaultdict
from pathlib import Path

from templates import (
    CARRIERS, DIRS, FEATURE_FOR, FILLER_PREFIX, FILLER_SUFFIX, FORMATIONS, POLICIES, T, TIMES, is_imperative,
)

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"

FEATURE_KINDS = [
    "altar", "vault", "prison", "chokepoint", "forge", "library", "fountain", "sarcophagus", "throne",
    "trapped_corridor", "treasure_room", "merchant_camp", "puzzle_room", "ritual_chamber", "war_room", "chest",
]
MODES = ["overworld", "town", "dungeon"]

TOWN_INTENTS = {"shop", "buy", "sell", "talk_to", "list_npcs", "quests", "accept_quest", "turn_in_quest", "depart_town", "report_camp", "tasks", "accept_task"}
DUNGEON_INTENTS = {"descend", "leave_dungeon", "search_traps", "disarm_trap", "search_room", "feature_inspect"} | set(FEATURE_FOR)
OVERWORLD_INTENTS = {"travel_to", "enter_dungeon", "go_to_town", "raid_camp"}

GENERIC_NPCS = [
    "the constable", "the innkeeper", "the blacksmith", "the priest", "the town wizard", "the guard captain", "the mayor",
    "the herbalist", "the fence", "the ranger", "the smith", "the merchant", "the barkeep", "the elder", "the sage",
]
GENERIC_POTIONS = ["healing potion", "potion", "a potion", "the potion", "antidote", "potion of healing", "the healing potion", "greater healing potion"]
GENERIC_SCROLLS = ["scroll", "the scroll", "scroll of fireball", "fireball scroll", "scroll of shield", "the fireball scroll"]
GENERIC_GEAR = ["sword", "shield", "armor", "longsword", "chain mail", "dagger", "bow", "the shield", "leather armor", "mace", "helm", "cloak", "ring", "amulet", "greataxe", "staff"]
GENERIC_ITEMS = ["rations", "torches", "rope", "a torch", "some rations", "arrows", "a lantern", "bandages"]

SYLLABLES = ["ka", "el", "ri", "th", "an", "dor", "mir", "vex", "za", "lun", "gar", "ith", "or", "en", "sha", "bel", "cor", "dra", "fen", "gil", "hal", "ish", "jor", "kel", "lor", "mal", "nor", "oth", "pyr", "quil", "ros", "syl", "tor", "ul", "var", "wyn", "xan", "yor", "zel"]

STOPWORDS = {"the", "a", "an", "to", "please", "now", "our", "us", "let's", "and"}


def make_name(rng: random.Random) -> str:
    n = rng.randint(2, 3)
    name = "".join(rng.choice(SYLLABLES) for _ in range(n)).capitalize()
    if rng.random() < 0.2:
        name += " " + "".join(rng.choice(SYLLABLES) for _ in range(rng.randint(2, 3))).capitalize()
    return name


def make_party_name(rng: random.Random, vocab) -> str:
    adj = ["Iron", "Silver", "Grey", "Crimson", "Wandering", "Bold", "Lost", "Ashen", "Golden", "Broken", "Hollow", "Bright"]
    noun = ["Hawks", "Company", "Blades", "Wolves", "Fellowship", "Lanterns", "Banners", "Shields", "Ravens", "Wardens", "Kin", "Spears"]
    style = rng.random()
    if style < 0.5:
        return f"The {rng.choice(adj)} {rng.choice(noun)}"
    if style < 0.8:
        return f"{rng.choice(adj)} {rng.choice(noun)}"
    return f"{rng.choice(vocab['lastNames'])}'s {rng.choice(noun)}"


def typo(word: str, rng: random.Random) -> str:
    if len(word) < 4:
        return word
    i = rng.randrange(1, len(word) - 1)
    kind = rng.random()
    if kind < 0.35:  # swap
        return word[:i] + word[i + 1] + word[i] + word[i + 2:]
    if kind < 0.65:  # drop
        return word[:i] + word[i + 1:]
    if kind < 0.85:  # duplicate
        return word[:i] + word[i] + word[i:]
    # neighbour key
    neighbours = {"a": "s", "s": "d", "d": "f", "e": "r", "r": "t", "t": "y", "o": "p", "i": "o", "n": "m", "m": "n", "u": "i", "l": "k", "c": "v", "h": "j", "g": "h", "w": "e"}
    ch = word[i]
    return word[:i] + neighbours.get(ch, ch) + word[i + 1:]


def wrap_in_carrier(text: str, rng: random.Random) -> str:
    """Put a bare order inside a conversational frame, as a person would say it."""
    return rng.choice(CARRIERS).format(text)


def add_noise(text: str, rng: random.Random) -> str:
    words = text.split(" ")
    if rng.random() < 0.15:
        j = rng.randrange(len(words))
        words[j] = typo(words[j], rng)
    if rng.random() < 0.05 and len(words) > 2:
        cand = [k for k, w in enumerate(words) if w.lower() in STOPWORDS]
        if cand:
            words.pop(rng.choice(cand))
    text = " ".join(words)
    if rng.random() < 0.25:
        pre = rng.choice(FILLER_PREFIX)
        if pre:
            text = f"{pre} {text}"
    if rng.random() < 0.20:
        suf = rng.choice(FILLER_SUFFIX)
        if suf:
            text = f"{text}{'' if suf in '!.…' else ' '}{suf}" if suf not in ("!", ".", "...") else f"{text}{suf}"
    r = rng.random()
    if r < 0.05:
        text = text.upper()
    elif r < 0.10:
        text = text.capitalize()
    return text


class Filler:
    def __init__(self, vocab: dict, rng: random.Random):
        self.v = vocab
        self.rng = rng
        self.monsters = vocab["monsters"] + vocab["bestiary"]
        self.npcs = vocab["questGivers"] + vocab["npcTemplates"] + GENERIC_NPCS + [n.split(" ")[0] for n in vocab["questGivers"]]
        self.potions = vocab["potions"] + GENERIC_POTIONS
        self.scrolls = vocab["scrolls"] + GENERIC_SCROLLS
        self.gear = vocab["gear"] + GENERIC_GEAR + vocab["magicItems"][:20]
        self.items = self.potions + self.scrolls + self.gear + GENERIC_ITEMS
        self.dests = vocab["towns"] + vocab["entrances"] + [e.replace("The ", "") for e in vocab["entrances"]]
        self.members = vocab["firstNames"]

    def fill(self, template: str, intent: str):
        rng = self.rng
        out = template
        slots = {}

        def sub(key, value):
            nonlocal out
            out = out.replace("{" + key + "}", value)
            slots[key] = value

        if "{dir}" in out:
            canon = rng.choice(list(DIRS))
            sub("dir", rng.choice(DIRS[canon]))
            slots["direction"] = canon
        if "{time}" in out:
            canon = rng.choice(list(TIMES))
            sub("time", rng.choice(TIMES[canon]))
            slots["time"] = canon
        if "{policy}" in out:
            canon = rng.choice(list(POLICIES))
            sub("policy", rng.choice(POLICIES[canon]))
            slots["policy"] = canon
        if "{formation}" in out:
            sub("formation", rng.choice(FORMATIONS))
        if "{dice}" in out:
            n = rng.choice(["", "", "1", "2", "3", "4", "8"])
            s = rng.choice([4, 6, 8, 10, 12, 20, 20, 20, 100])
            mod = rng.choice(["", "", "", "+1", "+2", "+3", "+5", "-1", "-2"])
            sub("dice", f"{n}d{s}{mod}")
        if "{slot}" in out:
            sub("slot", str(rng.randint(1, 3)))
        if "{qidx}" in out:
            sub("qidx", str(rng.randint(1, 4)))
        if "{monster}" in out:
            m = rng.choice(self.monsters)
            sub("monster", m if rng.random() < 0.6 else m.lower())
        if "{npc}" in out:
            sub("npc", rng.choice(self.npcs))
        if "{potion}" in out:
            p = rng.choice(self.potions)
            sub("potion", p if rng.random() < 0.5 else p.lower())
        if "{scroll}" in out:
            p = rng.choice(self.scrolls)
            sub("scroll", p if rng.random() < 0.5 else p.lower())
        if "{gear}" in out:
            g = rng.choice(self.gear)
            sub("gear", g if rng.random() < 0.5 else g.lower())
        if "{item}" in out:
            it = rng.choice(self.items)
            sub("item", it if rng.random() < 0.5 else it.lower())
        if "{dest}" in out:
            sub("dest", rng.choice(self.dests))
        if "{member}" in out:
            sub("member", rng.choice(self.members))
        if "{name}" in out:
            sub("name", make_party_name(rng, self.v) if intent == "rename_party" else make_name(rng))
        return out, slots


def sample_ctx(intent: str, rng: random.Random) -> dict:
    if intent in FEATURE_FOR:
        return {"featureKind": FEATURE_FOR[intent], "inCombat": False, "mode": "dungeon"}
    if intent == "search_room":
        return {"featureKind": None, "inCombat": False, "mode": "dungeon"}
    if intent == "feature_inspect":
        return {"featureKind": rng.choice(FEATURE_KINDS), "inCombat": False, "mode": "dungeon"}
    feature = None if rng.random() < 0.4 else rng.choice(FEATURE_KINDS)
    in_combat = rng.random() < 0.15
    if intent in TOWN_INTENTS:
        mode = "town" if rng.random() < 0.7 else rng.choice(MODES)
    elif intent in DUNGEON_INTENTS:
        mode = "dungeon" if rng.random() < 0.7 else rng.choice(MODES)
    elif intent in OVERWORLD_INTENTS:
        mode = "overworld" if rng.random() < 0.7 else rng.choice(MODES)
    else:
        mode = rng.choice(MODES)
    if mode != "dungeon":
        feature = None
    return {"featureKind": feature, "inCombat": in_combat, "mode": mode}


def gibberish(rng: random.Random, vocab: dict) -> str:
    kind = rng.random()
    if kind < 0.3:
        return "".join(rng.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(rng.randint(3, 9)))
    if kind < 0.5:
        return " ".join("".join(rng.choice("asdfghjklqwertyuiop") for _ in range(rng.randint(2, 6))) for _ in range(rng.randint(2, 4)))
    if kind < 0.75:
        # Word soup from game nouns — mentions things without ordering anything.
        pool = vocab["monsters"][:200] + vocab["towns"] + vocab["magicItems"][:20] + vocab["spells"][:30]
        return " ".join(rng.choice(pool).lower() for _ in range(rng.randint(1, 3)))
    # Statements about the world (no verb of command).
    subj = rng.choice(["the goblins", "that dragon", "our wizard", "the innkeeper", "the vault", "this dungeon", "the road", "the moon", "the party", "the constable"])
    pred = rng.choice(["is scary", "was here yesterday", "looks tired", "seems quiet tonight", "is very old", "smells terrible", "is far away", "is beautiful", "is not to be trusted", "has seen better days"])
    return f"{subj} {pred}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-intent", type=int, default=2500)
    ap.add_argument("--unknown", type=int, default=9000)
    ap.add_argument("--carrier-rate", type=float, default=0.5, help="fraction of imperative orders wrapped in conversational framing")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    vocab = json.loads((DATA / "vocab.json").read_text(encoding="utf-8"))
    intents = json.loads((DATA / "intents.json").read_text(encoding="utf-8"))
    filler = Filler(vocab, rng)

    train, dev = [], []
    seen = set()

    def emit(rows, text, intent, ctx, template):
        key = (text, intent, ctx["featureKind"], ctx["inCombat"], ctx["mode"])
        if key in seen:
            return
        seen.add(key)
        rows.append({"text": text, "intent": intent, "ctx": ctx, "template": template})

    for key, templates in T.items():
        intent = key.split(":")[0]
        assert intent in intents, f"template intent {intent} is not in intents.json"
        idx = list(range(len(templates)))
        rng.shuffle(idx)
        n_dev = max(1, len(templates) // 10) if len(templates) >= 5 else 0
        dev_idx = set(idx[:n_dev])
        target = args.unknown if intent == "unknown" else args.per_intent
        # Split the budget evenly over templates; slot-bearing templates get more variety naturally.
        per_template = max(4, target // max(1, len(templates)))
        for ti, tpl in enumerate(templates):
            rows = dev if ti in dev_idx else train
            has_slot = "{" in tpl
            carrierable = is_imperative(tpl)
            # A bare template yields few distinct sentences on its own; carriers
            # and slot fills are what create the variety, so budget accordingly.
            n = per_template if (has_slot or carrierable) else min(per_template, 40)
            for _ in range(n):
                text, _slots = filler.fill(tpl, intent)
                # Roughly half of orders arrive wrapped in conversational framing.
                if carrierable and rng.random() < args.carrier_rate:
                    text = wrap_in_carrier(text, rng)
                text = add_noise(text, rng)
                emit(rows, text, intent, sample_ctx(intent, rng), f"{key}#{ti}")

    # Procedural unknowns on top of the template ones.
    for i in range(args.unknown // 2):
        emit(train if i % 10 else dev, gibberish(rng, vocab), "unknown", sample_ctx("unknown", rng), "unknown#proc")

    rng.shuffle(train)
    rng.shuffle(dev)
    DATA.mkdir(exist_ok=True)
    for name, rows in (("train.jsonl", train), ("dev.jsonl", dev)):
        with (DATA / name).open("w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")

    by_intent = defaultdict(int)
    for r in train:
        by_intent[r["intent"]] += 1
    print(f"train: {len(train)} rows, dev: {len(dev)} rows, intents: {len(by_intent)}")
    low = sorted(by_intent.items(), key=lambda kv: kv[1])[:6]
    print("smallest classes:", low)


if __name__ == "__main__":
    main()
