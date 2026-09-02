"""
Weights export + the reference forward pass.

The binary layout is deliberately dull so src/ai/IntentModel.ts can read it
with a DataView and nothing else:

    bytes 0..3    magic "DMI1"
    bytes 4..7    uint32 LE header length N
    bytes 8..8+N  UTF-8 JSON header (intents, shapes, temperature, threshold)
    padding to a 4-byte boundary
    tensor section, tensors laid out in header order at 4-byte-aligned offsets

W1 ([buckets, hidden]) and W2 ([hidden, classes]) ship as row-wise symmetric
int8 with one float32 scale per row; the biases stay float32. That keeps the
file near half a megabyte while costing well under a point of accuracy.
"""
from __future__ import annotations

import json
import struct
from pathlib import Path
from typing import Dict

import numpy as np

MAGIC = b"DMI1"


def quantize_rows(w: np.ndarray):
    """Row-wise symmetric int8 quantisation. Returns (int8 matrix, float32 scales)."""
    w = np.asarray(w, dtype=np.float32)
    scales = np.abs(w).max(axis=1) / 127.0
    scales[scales == 0] = 1.0
    q = np.rint(w / scales[:, None]).clip(-127, 127).astype(np.int8)
    return q, scales.astype(np.float32)


def numpy_forward(features: Dict[int, float], W1: np.ndarray, b1: np.ndarray, W2: np.ndarray, b2: np.ndarray) -> np.ndarray:
    """
    Reference forward pass over dequantised weights, in the same order the
    TypeScript does it, so the two agree to well under 1e-4.
    """
    h = b1.astype(np.float32).copy()
    for bucket, weight in features.items():
        h += np.float32(weight) * W1[bucket]
    h = np.maximum(h, 0.0)
    return (b2.astype(np.float32) + h @ W2).astype(np.float32)


def write_model(path: Path, header: dict, W1q, W1s, b1, W2q, W2s, b2) -> int:
    tensors = [
        ("W1", "i8", list(W1q.shape), W1q.tobytes()),
        ("W1_scale", "f32", list(W1s.shape), W1s.astype(np.float32).tobytes()),
        ("b1", "f32", list(b1.shape), b1.astype(np.float32).tobytes()),
        ("W2", "i8", list(W2q.shape), W2q.tobytes()),
        ("W2_scale", "f32", list(W2s.shape), W2s.astype(np.float32).tobytes()),
        ("b2", "f32", list(b2.shape), b2.astype(np.float32).tobytes()),
    ]

    meta, blobs, offset = [], [], 0
    for name, dtype, shape, blob in tensors:
        pad = (-offset) % 4
        if pad:
            blobs.append(b"\x00" * pad)
            offset += pad
        meta.append({"name": name, "dtype": dtype, "shape": shape, "offset": offset, "bytes": len(blob)})
        blobs.append(blob)
        offset += len(blob)

    full = dict(header)
    full["tensors"] = meta
    header_bytes = json.dumps(full, separators=(",", ":")).encode("utf-8")

    out = bytearray()
    out += MAGIC
    out += struct.pack("<I", len(header_bytes))
    out += header_bytes
    out += b"\x00" * ((-len(out)) % 4)  # align the tensor section
    for blob in blobs:
        out += blob

    path.write_bytes(bytes(out))
    return len(out)
