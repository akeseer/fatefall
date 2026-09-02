"""
Text featurizer for the DM intent model.

MUST stay byte-for-byte equivalent to `featurize` in src/ai/IntentModel.ts:
same normalisation, same feature strings, same FNV-1a hashing, same bucket
count and same L2 scaling. `tests/fixtures/featurizer-parity.json` (written by
export.py) is checked by the TypeScript test-suite to prove they agree.
"""
from __future__ import annotations

import math
import re
import unicodedata
from typing import Dict, Iterable, List, Optional

BUCKETS = 8192
CHAR_NGRAMS = (1, 2, 3)

_QUOTES = {
    "‘": "'", "’": "'", "ʼ": "'", "“": '"', "”": '"',
}
_KEEP = re.compile(r"[^a-z0-9' +\-]")
_WS = re.compile(r"\s+")


def normalize_text(text: str) -> str:
    s = unicodedata.normalize("NFC", text)
    s = s.lower()
    for k, v in _QUOTES.items():
        s = s.replace(k, v)
    s = _KEEP.sub(" ", s)
    s = _WS.sub(" ", s).strip()
    return s


def fnv1a32(s: str) -> int:
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def feature_strings(text: str, feature_kind: Optional[str], in_combat: bool, mode: str) -> List[str]:
    """The raw (un-hashed) feature strings, in emission order."""
    norm = normalize_text(text)
    toks = norm.split(" ") if norm else []
    out: List[str] = []
    for t in toks:
        out.append("w:" + t)
    for a, b in zip(toks, toks[1:]):
        out.append("b:" + a + "_" + b)
    for t in toks:
        padded = "<" + t + ">"
        for n in CHAR_NGRAMS:
            for i in range(0, len(padded) - n + 1):
                out.append("c:" + padded[i:i + n])
    out.append("x:feat=" + (feature_kind or "none"))
    out.append("x:combat=" + ("1" if in_combat else "0"))
    out.append("x:mode=" + mode)
    return out


def featurize(text: str, feature_kind: Optional[str], in_combat: bool, mode: str,
              buckets: int = BUCKETS, drop_context: bool = False) -> Dict[int, float]:
    """Sparse L2-normalised bucket -> weight map."""
    counts: Dict[int, float] = {}
    for f in feature_strings(text, feature_kind, in_combat, mode):
        if drop_context and f.startswith("x:"):
            continue
        b = fnv1a32(f) & (buckets - 1)
        counts[b] = counts.get(b, 0.0) + 1.0
    norm = math.sqrt(sum(v * v for v in counts.values()))
    if norm > 0:
        for k in counts:
            counts[k] /= norm
    return counts


def featurize_batch(rows: Iterable[dict], buckets: int = BUCKETS, drop_context_p: float = 0.0, rng=None):
    """Yield (indices, values) pairs for a batch of dataset rows."""
    for r in rows:
        drop = bool(rng is not None and drop_context_p > 0 and rng.random() < drop_context_p)
        feats = featurize(r["text"], r["ctx"].get("featureKind"), bool(r["ctx"].get("inCombat")), r["ctx"].get("mode", "dungeon"),
                          buckets=buckets, drop_context=drop)
        idx = sorted(feats)
        yield idx, [feats[i] for i in idx]
