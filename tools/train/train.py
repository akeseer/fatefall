"""
Train the DM intent model and export it for the game.

  python tools/train/train.py [--epochs 8] [--hidden 64] [--buckets 8192] [--out public/models/dm-intent-v1.bin]

Inputs : data/train.jsonl, data/dev.jsonl, data/canonical_train.jsonl, data/intents.json
Outputs: the weights file, tests/fixtures/featurizer-parity.json,
         tests/fixtures/logits-parity.json, data/runs/<stamp>/report.json

Model: hashed n-gram bag (see featurizer.py) → EmbeddingBag(sum) → +bias →
ReLU → dropout → Linear → one logit per intent. Trains in about a minute.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import sys
import torch
import torch.nn as nn
import torch.nn.functional as F

from featurizer import BUCKETS, featurize, feature_strings, fnv1a32
from export import write_model, quantize_rows, numpy_forward

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
ROOT = HERE.parent.parent


# ── Data ─────────────────────────────────────────────────────────────────────

def read_jsonl(path: Path):
    with path.open(encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


class Encoded:
    """Rows featurised once into flat index/value arrays with a context mask."""

    def __init__(self, rows, intents, buckets):
        self.labels = torch.tensor([intents.index(r["intent"]) for r in rows], dtype=torch.long)
        idx, val, is_ctx, offsets = [], [], [], [0]
        for r in rows:
            ctx = r["ctx"]
            strings = feature_strings(r["text"], ctx.get("featureKind"), bool(ctx.get("inCombat")), ctx.get("mode", "dungeon"))
            counts = {}
            ctx_buckets = set()
            for s in strings:
                b = fnv1a32(s) & (buckets - 1)
                counts[b] = counts.get(b, 0.0) + 1.0
                if s.startswith("x:"):
                    ctx_buckets.add(b)
            norm = math.sqrt(sum(v * v for v in counts.values())) or 1.0
            for b in sorted(counts):
                idx.append(b)
                val.append(counts[b] / norm)
                is_ctx.append(b in ctx_buckets)
            offsets.append(len(idx))
        self.idx = torch.tensor(idx, dtype=torch.long)
        self.val = torch.tensor(val, dtype=torch.float32)
        self.is_ctx = torch.tensor(is_ctx, dtype=torch.bool)
        self.offsets = torch.tensor(offsets, dtype=torch.long)
        self.n = len(rows)
        self.rows = rows

    def batch(self, ids, device, ctx_drop_p=0.0, rng=None):
        starts = self.offsets[ids]
        ends = self.offsets[ids + 1]
        lengths = ends - starts
        pieces = [torch.arange(s, e) for s, e in zip(starts.tolist(), ends.tolist())]
        flat = torch.cat(pieces) if pieces else torch.zeros(0, dtype=torch.long)
        idx = self.idx[flat]
        val = self.val[flat].clone()
        if ctx_drop_p > 0:
            drop_sample = torch.rand(len(ids), generator=rng) < ctx_drop_p
            per_entry = torch.repeat_interleave(drop_sample, lengths)
            val[per_entry & self.is_ctx[flat]] = 0.0
        offs = torch.cat([torch.zeros(1, dtype=torch.long), torch.cumsum(lengths, 0)[:-1]])
        return idx.to(device), offs.to(device), val.to(device), self.labels[ids].to(device)


FEATURE_INTENT_KIND = {
    "feature_altar": "altar", "feature_vault": "vault", "feature_prison": "prison",
    "feature_chokepoint": "chokepoint", "feature_forge": "forge", "feature_library": "library",
    "feature_fountain": "fountain", "feature_sarcophagus": "sarcophagus", "feature_throne": "throne",
    "feature_trapped_search": "trapped_corridor", "feature_trapped_disarm": "trapped_corridor",
    "feature_treasure": "treasure_room", "feature_merchant_talk": "merchant_camp",
    "feature_merchant_rob": "merchant_camp", "feature_puzzle": "puzzle_room",
    "feature_ritual": "ritual_chamber", "feature_war_room": "war_room",
}


def intent_allowed(intent: str, ctx: dict) -> bool:
    """Must stay in step with intentAllowed() in src/ai/DMCommand.ts."""
    in_combat = bool(ctx.get("inCombat"))
    feature = ctx.get("featureKind")
    kind = FEATURE_INTENT_KIND.get(intent)
    if kind is not None:
        return (not in_combat) and feature == kind
    if intent == "feature_inspect":
        return (not in_combat) and feature is not None
    if intent == "search_room":
        return (not in_combat) and feature is None and ctx.get("mode") == "dungeon"
    return True


def gate_mask(intents, ctx):
    return np.array([intent_allowed(i, ctx) for i in intents], dtype=bool)


# ── Model ────────────────────────────────────────────────────────────────────

class IntentNet(nn.Module):
    def __init__(self, buckets, hidden, classes, dropout=0.2):
        super().__init__()
        self.emb = nn.EmbeddingBag(buckets, hidden, mode="sum")
        self.b1 = nn.Parameter(torch.zeros(hidden))
        self.drop = nn.Dropout(dropout)
        self.out = nn.Linear(hidden, classes)
        nn.init.normal_(self.emb.weight, std=0.05)

    def forward(self, idx, offs, val):
        h = self.emb(idx, offs, per_sample_weights=val) + self.b1
        h = F.relu(h)
        return self.out(self.drop(h))


# ── Training ─────────────────────────────────────────────────────────────────

def evaluate(model, enc, device, bs=2048):
    model.eval()
    logits_all = []
    with torch.no_grad():
        for start in range(0, enc.n, bs):
            ids = torch.arange(start, min(enc.n, start + bs))
            idx, offs, val, _ = enc.batch(ids, device)
            logits_all.append(model(idx, offs, val).cpu())
    logits = torch.cat(logits_all)
    acc = (logits.argmax(1) == enc.labels).float().mean().item()
    return logits, acc


def fit_temperature(logits, labels):
    t = torch.ones(1, requires_grad=True)
    opt = torch.optim.LBFGS([t], lr=0.05, max_iter=200)

    def closure():
        opt.zero_grad()
        loss = F.cross_entropy(logits / t.clamp_min(0.05), labels)
        loss.backward()
        return loss

    opt.step(closure)
    return float(t.clamp_min(0.05).item())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--hidden", type=int, default=64)
    ap.add_argument("--buckets", type=int, default=BUCKETS)
    ap.add_argument("--batch", type=int, default=512)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--ctx-drop", type=float, default=0.3)
    ap.add_argument("--label-smoothing", type=float, default=0.05)
    ap.add_argument("--canonical-weight", type=int, default=20, help="how many times to repeat canonical rows in training")
    ap.add_argument("--threshold", type=float, default=0.6)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", default=str(ROOT / "public" / "models" / "dm-intent-v1.bin"))
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"device: {device}")

    intents = json.loads((DATA / "intents.json").read_text(encoding="utf-8"))
    train_rows = read_jsonl(DATA / "train.jsonl")
    dev_rows = read_jsonl(DATA / "dev.jsonl")
    canonical_rows = read_jsonl(DATA / "canonical_train.jsonl") if (DATA / "canonical_train.jsonl").exists() else []
    train_rows = train_rows + canonical_rows * args.canonical_weight
    print(f"train rows: {len(train_rows)} (incl. {len(canonical_rows)}×{args.canonical_weight} canonical), dev rows: {len(dev_rows)}, classes: {len(intents)}")

    t0 = time.time()
    train = Encoded(train_rows, intents, args.buckets)
    dev = Encoded(dev_rows, intents, args.buckets)
    canon = Encoded(canonical_rows, intents, args.buckets) if canonical_rows else None
    print(f"featurised in {time.time() - t0:.1f}s; avg active buckets/row: {len(train.idx) / max(1, train.n):.1f}")

    model = IntentNet(args.buckets, args.hidden, len(intents)).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    steps_per_epoch = math.ceil(train.n / args.batch)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=args.epochs * steps_per_epoch)
    gen = torch.Generator().manual_seed(args.seed)

    best = None
    for epoch in range(1, args.epochs + 1):
        model.train()
        perm = torch.randperm(train.n, generator=gen)
        total, correct, loss_sum = 0, 0, 0.0
        t1 = time.time()
        for start in range(0, train.n, args.batch):
            ids = perm[start:start + args.batch]
            idx, offs, val, y = train.batch(ids, device, ctx_drop_p=args.ctx_drop, rng=gen)
            logits = model(idx, offs, val)
            loss = F.cross_entropy(logits, y, label_smoothing=args.label_smoothing)
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            loss_sum += loss.item() * len(ids)
            correct += (logits.argmax(1) == y).sum().item()
            total += len(ids)
        _, dev_acc = evaluate(model, dev, device)
        canon_acc = evaluate(model, canon, device)[1] if canon else float("nan")
        print(f"epoch {epoch}: loss {loss_sum / total:.4f} train acc {correct / total:.4f} dev acc {dev_acc:.4f} canonical acc {canon_acc:.4f} ({time.time() - t1:.1f}s)")
        state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        if best is None or dev_acc >= best[0]:
            best = (dev_acc, state)

    model.load_state_dict(best[1])
    model.to(device)
    dev_logits, dev_acc = evaluate(model, dev, device)
    temperature = fit_temperature(dev_logits, dev.labels)
    print(f"best dev acc {dev_acc:.4f}; temperature {temperature:.3f}")

    # ── Export (int8) and re-evaluate with the quantised weights ──
    W1 = model.emb.weight.detach().cpu().numpy().astype(np.float32)          # [B, H]
    b1 = model.b1.detach().cpu().numpy().astype(np.float32)
    W2 = model.out.weight.detach().cpu().numpy().T.astype(np.float32)        # [H, C]
    b2 = model.out.bias.detach().cpu().numpy().astype(np.float32)
    W1q, W1s = quantize_rows(W1)
    W2q, W2s = quantize_rows(W2)
    deq = (W1q.astype(np.float32) * W1s[:, None], b1, W2q.astype(np.float32) * W2s[:, None], b2)

    def q_eval(enc):
        """Quantised forward pass with the same context gating the game applies."""
        preds, probs, margins = [], [], []
        for r in enc.rows:
            ctx = r["ctx"]
            feats = featurize(r["text"], ctx.get("featureKind"), bool(ctx.get("inCombat")), ctx.get("mode", "dungeon"), buckets=args.buckets)
            lg = numpy_forward(feats, *deq) / temperature
            lg = np.where(gate_mask(intents, ctx), lg, -1e9)
            p = np.exp(lg - lg.max())
            p /= p.sum()
            order = np.argsort(-p)
            preds.append(int(order[0]))
            probs.append(float(p[order[0]]))
            margins.append(float(p[order[0]] - p[order[1]]))
        return np.array(preds), np.array(probs), np.array(margins)

    dev_pred, dev_prob, dev_margin = q_eval(dev)
    dev_labels = dev.labels.numpy()
    q_acc = float((dev_pred == dev_labels).mean())
    unknown_i = intents.index("unknown")
    accept = (dev_prob >= args.threshold) & (dev_margin >= 0.15) & (dev_pred != unknown_i)
    acc_on_accepted = float((dev_pred[accept] == dev_labels[accept]).mean()) if accept.any() else float("nan")
    wrong_accepted_unknown = int(((dev_labels == unknown_i) & accept).sum())
    print(f"int8 dev acc {q_acc:.4f}; accepted {accept.mean():.3f} of dev at threshold {args.threshold} with acc {acc_on_accepted:.4f}; unknown rows wrongly accepted: {wrong_accepted_unknown}/{int((dev_labels == unknown_i).sum())}")
    canonical_overrides = []
    if canon:
        c_pred, c_prob, c_margin = q_eval(canon)
        c_labels = canon.labels.numpy()
        c_acc = float((c_pred == c_labels).mean())
        # What actually reaches the game: a wrong answer only lands if the model
        # is confident enough for understand() to override the regex.
        confident = (c_prob >= args.threshold) & (c_margin >= 0.15)
        bad = np.where((c_pred != c_labels) & confident)[0]
        canonical_overrides = [(canon.rows[i]["text"], intents[c_labels[i]], intents[c_pred[i]], round(float(c_prob[i]), 3)) for i in bad]
        print(f"int8 canonical acc {c_acc:.4f}; confident overrides of the regex: {len(bad)}")
        for row in canonical_overrides[:20]:
            print(f"    {row[0]!r}: regex {row[1]} -> model {row[2]} @ {row[3]}")
        quiet = np.where((c_pred != c_labels) & ~confident)[0]
        print(f"    ({len(quiet)} further canonical misses were below the accept bar, so the regex answer stands)")

    confusion = Counter()
    for p, y in zip(dev_pred, dev_labels):
        if p != y:
            confusion[(intents[y], intents[p])] += 1
    print("top confusions (true -> predicted):")
    for (a, b), n in confusion.most_common(12):
        print(f"  {n:4d}  {a} → {b}")

    per_class = defaultdict(lambda: [0, 0])
    for p, y in zip(dev_pred, dev_labels):
        per_class[intents[y]][1] += 1
        per_class[intents[y]][0] += int(p == y)
    weakest = sorted(((c, n[0] / n[1]) for c, n in per_class.items() if n[1]), key=lambda x: x[1])[:8]
    print("weakest classes:", [(c, round(a, 3)) for c, a in weakest])

    header = {
        "version": 1,
        "buckets": args.buckets,
        "hidden": args.hidden,
        "intents": intents,
        "temperature": round(temperature, 4),
        "threshold": args.threshold,
        "trainedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "devAccuracy": round(q_acc, 4),
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    size = write_model(out, header, W1q, W1s, b1, W2q, W2s, b2)
    print(f"wrote {out} ({size / 1024:.0f} KB)")

    # ── Parity fixtures for the TypeScript tests ──
    fixtures = ROOT / "tests" / "fixtures"
    fixtures.mkdir(parents=True, exist_ok=True)
    samples = [
        ("go north", None, False, "dungeon"), ("Head WEST, quickly!", None, True, "overworld"),
        ("summon a Young Red Dragon", "vault", False, "dungeon"), ("pray at the altar", "altar", False, "dungeon"),
        ("roll 2d6+3", None, False, "town"), ("what’s in the “pack”?", None, False, "dungeon"),
        ("talk to Brenna Ironforge", None, False, "town"), ("", None, False, "dungeon"), ("   ", "forge", True, "town"),
        ("ünïcödé façade naïve", None, False, "dungeon"), ("rename Kael to Xarthax-the-Bold", None, False, "dungeon"),
        ("buy 2 potions & rope", None, False, "town"), ("a" * 40, None, False, "dungeon"),
    ] + [(r["text"], r["ctx"].get("featureKind"), bool(r["ctx"].get("inCombat")), r["ctx"].get("mode", "dungeon")) for r in dev_rows[:51]]
    feat_fixture, logit_fixture = [], []
    for text, fk, ic, mode in samples:
        feats = featurize(text, fk, ic, mode, buckets=args.buckets)
        items = sorted(feats.items())
        feat_fixture.append({"text": text, "ctx": {"featureKind": fk, "inCombat": ic, "mode": mode}, "features": [[int(b), round(float(w), 7)] for b, w in items]})
        lg = numpy_forward(feats, *deq)
        logit_fixture.append({"text": text, "ctx": {"featureKind": fk, "inCombat": ic, "mode": mode}, "logits": [round(float(x), 5) for x in lg]})
    (fixtures / "featurizer-parity.json").write_text(json.dumps(feat_fixture, ensure_ascii=False, indent=0), encoding="utf-8")
    (fixtures / "logits-parity.json").write_text(json.dumps(logit_fixture, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"wrote parity fixtures ({len(samples)} samples)")

    runs = DATA / "runs"
    runs.mkdir(exist_ok=True)
    (runs / f"report-{time.strftime('%Y%m%d-%H%M%S')}.json").write_text(json.dumps({
        "args": vars(args), "dev_acc_float": dev_acc, "dev_acc_int8": q_acc, "temperature": temperature,
        "accepted_fraction": float(accept.mean()), "acc_on_accepted": acc_on_accepted,
        "canonical_confident_overrides": canonical_overrides,
        "top_confusions": [[a, b, n] for (a, b), n in confusion.most_common(20)],
    }, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
