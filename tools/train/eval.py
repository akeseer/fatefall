"""
Score the shipped DM intent model on the dev split.

  python tools/train/eval.py [--model public/models/dm-intent-v1.bin] [--split data/dev.jsonl]
                             [--bins 10] [--pairs 15] [--classes 15] [--all-classes]

Inputs : public/models/dm-intent-v1.bin, data/dev.jsonl, data/intents.json
Outputs: none. This reads what the pipeline already wrote and prints; it never
         touches the weights, the split, or data/runs.

train.py reports the headline of the run it just finished. This answers the
questions that only matter once the weights are shipped: where the mistakes
cluster, whether the confidence the runtime gates on means anything, how far the
model has drifted from the regex cascade that labelled it, and whether `unknown`
is precise enough to be trusted as "that was table talk, not an order".

Everything is measured on the quantised weights in the .bin, at the temperature
and threshold in its header, with the same context gating the game applies — so
the numbers are the ones the player gets, not the ones the float model would.
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
from collections import Counter
from pathlib import Path

import numpy as np

from featurizer import featurize
from export import MAGIC, numpy_forward
from train import gate_mask, read_jsonl

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
ROOT = HERE.parent.parent


# ── The shipped weights ──────────────────────────────────────────────────────

def read_model(path: Path):
    """Inverse of export.write_model: header plus dequantised float32 tensors."""
    raw = path.read_bytes()
    if raw[:4] != MAGIC:
        raise ValueError(f"{path}: bad magic {raw[:4]!r}, expected {MAGIC!r}")
    n = struct.unpack_from("<I", raw, 4)[0]
    header = json.loads(raw[8:8 + n].decode("utf-8"))
    start = (8 + n + 3) & ~3  # the tensor section is 4-byte aligned
    tensors = {}
    for t in header["tensors"]:
        off = start + t["offset"]
        dtype = np.int8 if t["dtype"] == "i8" else np.float32
        tensors[t["name"]] = np.frombuffer(raw[off:off + t["bytes"]], dtype=dtype).reshape(t["shape"])
    W1 = tensors["W1"].astype(np.float32) * tensors["W1_scale"][:, None]   # [buckets, hidden]
    W2 = tensors["W2"].astype(np.float32) * tensors["W2_scale"][:, None]   # [hidden, classes]
    return header, W1, tensors["b1"].astype(np.float32), W2, tensors["b2"].astype(np.float32), len(raw)


def predict(rows, intents, W1, b1, W2, b2, temperature, buckets):
    """
    Top-1 intent, its probability and its margin over the runner-up, for every
    row — the quantised forward pass with context-invalid intents masked out,
    exactly as IntentModel.probabilities() does it.
    """
    preds = np.zeros(len(rows), dtype=np.int64)
    probs = np.zeros(len(rows), dtype=np.float64)
    margins = np.zeros(len(rows), dtype=np.float64)
    masks = {}
    for i, r in enumerate(rows):
        ctx = r["ctx"]
        key = (ctx.get("featureKind"), bool(ctx.get("inCombat")), ctx.get("mode", "dungeon"))
        mask = masks.get(key)
        if mask is None:
            mask = masks[key] = gate_mask(intents, ctx)
        feats = featurize(r["text"], key[0], key[1], key[2], buckets=buckets)
        lg = numpy_forward(feats, W1, b1, W2, b2) / temperature
        lg = np.where(mask, lg, -1e9)
        p = np.exp(lg - lg.max())
        p /= p.sum()
        order = np.argsort(-p)
        preds[i] = order[0]
        probs[i] = p[order[0]]
        margins[i] = p[order[0]] - p[order[1]]
    return preds, probs, margins


# ── Metrics ──────────────────────────────────────────────────────────────────

def per_class_prf(preds, labels, classes):
    """
    Per-class precision, recall, F1 and support, as float arrays of length
    `classes`. A class nothing was predicted for gets precision 0.0; a class with
    no support gets recall 0.0 (and is skipped in the macro averages).
    """
    tp = np.bincount(labels[preds == labels], minlength=classes).astype(np.float64)
    predicted = np.bincount(preds, minlength=classes).astype(np.float64)
    support = np.bincount(labels, minlength=classes).astype(np.float64)
    precision = np.divide(tp, predicted, out=np.zeros(classes), where=predicted > 0)
    recall = np.divide(tp, support, out=np.zeros(classes), where=support > 0)
    denom = precision + recall
    f1 = np.divide(2 * precision * recall, denom, out=np.zeros(classes), where=denom > 0)
    return precision, recall, f1, support


def calibration(confidence, correct, bins=10):
    """
    Equal-width reliability bins over the top-1 confidence.

    Returns (ece, mce, rows) where each row is
    (lo, hi, count, mean confidence, accuracy, accuracy - confidence). ECE is the
    support-weighted mean of |accuracy - confidence| over non-empty bins; MCE is
    the largest single gap. A negative gap means the bin is overconfident.
    """
    confidence = np.asarray(confidence, dtype=np.float64)
    correct = np.asarray(correct, dtype=np.float64)
    # b / bins, not linspace: linspace's 0.6 is a hair above the double 0.6, which
    # would drop a confidence of exactly 0.6 into the bin below it.
    edges = np.arange(bins + 1, dtype=np.float64) / bins
    which = np.clip(np.digitize(confidence, edges[1:-1], right=False), 0, bins - 1)
    total = len(confidence)
    ece, mce, rows = 0.0, 0.0, []
    for b in range(bins):
        sel = which == b
        n = int(sel.sum())
        if not n:
            rows.append((edges[b], edges[b + 1], 0, float("nan"), float("nan"), float("nan")))
            continue
        conf = float(confidence[sel].mean())
        acc = float(correct[sel].mean())
        gap = acc - conf
        ece += (n / total) * abs(gap)
        mce = max(mce, abs(gap))
        rows.append((edges[b], edges[b + 1], n, conf, acc, gap))
    return ece, mce, rows


def confusion_pairs(preds, labels, intents):
    """Counter of (true, predicted) -> count over the rows that were got wrong."""
    pairs = Counter()
    for p, y in zip(preds, labels):
        if p != y:
            pairs[(intents[y], intents[p])] += 1
    return pairs


# ── Report ───────────────────────────────────────────────────────────────────

def pct(x):
    return "   n/a" if x != x else f"{100 * x:5.1f}%"


def need(path: Path, step: str):
    if not path.exists():
        sys.exit(f"eval.py: {path} is missing.\n  Run `{step}` first (see tools/train/README.md).")
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(ROOT / "public" / "models" / "dm-intent-v1.bin"))
    ap.add_argument("--split", default=str(DATA / "dev.jsonl"))
    ap.add_argument("--threshold", type=float, default=None, help="override the accept bar in the model header")
    ap.add_argument("--margin", type=float, default=0.15, help="MODEL_MIN_MARGIN in DMCommandParser.ts")
    ap.add_argument("--bins", type=int, default=10, help="reliability bins for the calibration table")
    ap.add_argument("--pairs", type=int, default=15, help="how many confused pairs to list")
    ap.add_argument("--classes", type=int, default=15, help="how many weakest intents to table")
    ap.add_argument("--all-classes", action="store_true", help="table every intent instead of the weakest")
    ap.add_argument("--unknown-bar", type=float, default=0.95, help="the precision `unknown` is required to clear")
    args = ap.parse_args()

    model_path = need(Path(args.model), "python tools/train/train.py --epochs 16")
    split_path = need(Path(args.split), "python tools/train/gen_data.py && npm run label-data")
    intents_path = need(DATA / "intents.json", "npm run export-vocab")

    intents = json.loads(intents_path.read_text(encoding="utf-8"))
    header, W1, b1, W2, b2, size = read_model(model_path)
    if header["intents"] != intents:
        sys.exit(
            f"eval.py: {model_path.name} was trained on {len(header['intents'])} intents that do not match "
            f"the {len(intents)} in {intents_path.name}.\n"
            "  Run `npm run export-vocab` and retrain (see tools/train/README.md)."
        )
    rows = read_jsonl(split_path)
    if not rows:
        sys.exit(f"eval.py: {split_path} is empty.\n  Run `python tools/train/gen_data.py` first.")
    if any("regex_intent" not in r for r in rows):
        sys.exit(f"eval.py: {split_path} has unlabelled rows.\n  Run `npm run label-data` first.")

    threshold = args.threshold if args.threshold is not None else header.get("threshold", 0.6)
    temperature = header.get("temperature", 1.0) or 1.0
    buckets = header["buckets"]
    unknown_i = intents.index("unknown")

    labels = np.array([intents.index(r["intent"]) for r in rows], dtype=np.int64)
    regex = np.array([intents.index(r["regex_intent"]) for r in rows], dtype=np.int64)
    preds, probs, margins = predict(rows, intents, W1, b1, W2, b2, temperature, buckets)
    right = preds == labels
    accept = (probs >= threshold) & (margins >= args.margin) & (preds != unknown_i)

    print(f"DM intent model v{header['version']} — {model_path}")
    print(f"  {len(intents)} intents · {buckets} buckets · {header['hidden']} hidden · {size / 1024:.0f} KB"
          f" · trained {header.get('trainedAt', '?')}")
    print(f"  temperature {temperature:.3f}, accepts at {threshold:.2f} confidence and {args.margin:.2f} margin")
    print(f"  split: {split_path} — {len(rows)} rows, {len(set(labels.tolist()))} intents present\n")

    print("Accuracy")
    print(f"  overall              {pct(right.mean())}   ({int(right.sum())}/{len(rows)})")
    acc_accepted = right[accept].mean() if accept.any() else float("nan")
    print(f"  on accepted rows     {pct(acc_accepted)}   ({int(accept.sum())} rows, "
          f"{pct(accept.mean()).strip()} of the split, clear the accept bar)")
    print(f"  on rejected rows     {pct(right[~accept].mean() if (~accept).any() else float('nan'))}"
          f"   (the regex answer stands for these)\n")

    # ── Confusion ──
    precision, recall, f1, support = per_class_prf(preds, labels, len(intents))
    pairs = confusion_pairs(preds, labels, intents)
    wrong = int((~right).sum())
    shown = pairs.most_common(args.pairs)
    covered = sum(n for _, n in shown)
    width = max((len(a) for (a, _), _ in shown), default=4)
    print(f"Confused pairs ({len(pairs)} distinct, {wrong} wrong rows; the top {len(shown)} are {pct(covered / wrong).strip()} of them)")
    print(f"  {'count':>5}  {'true':<{width}}    {'predicted':<{width}}  share of true")
    for (true_name, pred_name), n in shown:
        share = n / support[intents.index(true_name)]
        print(f"  {n:5d}  {true_name:<{width}} →  {pred_name:<{width}}  {pct(share)}")
    print()

    # ── Per-intent P/R/F1 ──
    order = [i for i in np.argsort(f1) if support[i] > 0]
    if args.all_classes:
        print(f"Every intent, weakest F1 first ({len(order)})")
    else:
        order = order[:max(0, args.classes)]
        print(f"Weakest intents by F1 ({len(order)} of {int((support > 0).sum())}; --all-classes for the rest)")
    name_w = max((len(intents[i]) for i in order), default=6)
    print(f"  {'intent':<{name_w}}  {'prec':>6}  {'recall':>6}  {'F1':>6}  {'support':>7}")
    for i in order:
        print(f"  {intents[i]:<{name_w}}  {precision[i]:6.3f}  {recall[i]:6.3f}  {f1[i]:6.3f}  {int(support[i]):7d}")
    seen = support > 0
    print(f"  macro F1 {f1[seen].mean():.4f} over {int(seen.sum())} intents · "
          f"micro F1 {right.mean():.4f} (= accuracy, single-label)\n")

    # ── Calibration ──
    ece, mce, bins = calibration(probs, right, args.bins)
    hi = probs >= threshold
    ece_hi = calibration(probs[hi], right[hi], args.bins)[0] if hi.any() else float("nan")
    print(f"Calibration — ECE {ece:.4f}, MCE {mce:.4f}, ECE above the {threshold:.2f} bar {ece_hi:.4f}")
    print(f"  {'confidence':<12}  {'n':>6}  {'conf':>6}  {'acc':>6}  {'gap':>7}")
    for lo, up, n, conf, acc, gap in bins:
        if n == 0:
            continue
        flag = "" if lo + 1e-9 >= threshold else "  below the bar"
        print(f"  {lo:.2f}–{up:.2f}    {n:6d}  {conf:6.3f}  {acc:6.3f}  {gap:+7.3f}{flag}")
    print("  gap = accuracy - confidence; negative means the model is overconfident there.\n")

    # ── Regex agreement ──
    agree = preds == regex
    decisive = regex != unknown_i
    print("Regex agreement (the cascade in DMCommandParser.ts is the labelling oracle)")
    print(f"  overall              {pct(agree.mean())}   ({int(agree.sum())}/{len(rows)})")
    print(f"  where regex decides  {pct(agree[decisive].mean() if decisive.any() else float('nan'))}"
          f"   ({int(decisive.sum())} rows the regex reads on its own)")
    print(f"  where regex is lost  {pct(agree[~decisive].mean() if (~decisive).any() else float('nan'))}"
          f"   ({int((~decisive).sum())} rows; agreement here means the model also said unknown)")
    split_rows = decisive & ~agree
    if split_rows.any():
        model_right = int((right & split_rows).sum())
        regex_right = int(((regex == labels) & split_rows).sum())
        both_wrong = int(split_rows.sum()) - model_right - regex_right
        print(f"  when they disagree and the regex committed ({int(split_rows.sum())} rows): "
              f"model right {model_right}, regex right {regex_right}, both wrong {both_wrong}")
    added = ~decisive & right
    print(f"  the model reads {int(added.sum())} rows the regex could not "
          f"({pct(added.sum() / max(1, (~decisive).sum())).strip()} of them)\n")

    # ── unknown, on its own ──
    called = preds == unknown_i
    truly = labels == unknown_i
    hits = int((called & truly).sum())
    u_precision = hits / int(called.sum()) if called.any() else float("nan")
    u_recall = hits / int(truly.sum()) if truly.any() else float("nan")
    u_f1 = 2 * u_precision * u_recall / (u_precision + u_recall) if (u_precision + u_recall) else 0.0
    verdict = "PASS" if u_precision >= args.unknown_bar else "FAIL"
    print("`unknown` — table talk the party must not act on")
    print(f"  precision            {pct(u_precision)}   ({hits} of the {int(called.sum())} rows called unknown really were)")
    print(f"  recall               {pct(u_recall)}   ({hits} of the {int(truly.sum())} unknown rows were caught)")
    print(f"  F1                   {pct(u_f1)}")
    print(f"  bar: precision >= {args.unknown_bar:.2f}   {verdict}")
    leaked = Counter(intents[p] for p, t in zip(preds, truly) if t and p != unknown_i)
    acted = int((truly & accept).sum())
    print(f"  chatter that clears the accept bar and would be acted on: {acted}"
          f" of {int(truly.sum())} ({pct(acted / max(1, int(truly.sum()))).strip()})")
    if leaked:
        print("  unknown rows leak most often to: " + ", ".join(f"{k} ({n})" for k, n in leaked.most_common(6)))


if __name__ == "__main__":
    main()
