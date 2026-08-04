#!/usr/bin/env python3
"""
Persistent Real-ESRGAN-class upscale worker using waifu2x cunet ONNX model.

Protocol (stdin → stdout, one JSON object per line):
  Request:  {"id": "<str>", "input_path": "<path>", "scale": 2|4}
  Response: {"id": "<str>", "output_path": "<path>"}   on success
            {"id": "<str>", "error": "<msg>"}          on failure
  Ready:    {"ready": true, "backend": "waifu2x"|"lanczos"}  written once on startup
"""

import sys, os, json, traceback, hashlib, tempfile, subprocess


def _ensure_packages() -> None:
    """Auto-install required Python packages if missing (e.g. after env reprovision)."""
    required = {"numpy": "numpy", "PIL": "pillow", "onnxruntime": "onnxruntime"}
    missing = []
    for mod, pkg in required.items():
        try:
            __import__(mod)
        except ImportError:
            missing.append(pkg)
    if missing:
        sys.stderr.write(f"[upscale_worker] Installing missing packages: {missing}\n")
        sys.stderr.flush()
        try:
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "--user",
                 "--break-system-packages", "--quiet", *missing],
                stderr=subprocess.DEVNULL,
            )
            sys.stderr.write("[upscale_worker] Packages installed.\n")
            sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"[upscale_worker] pip install failed: {e}\n")
            sys.stderr.flush()


_ensure_packages()

import numpy as np
from PIL import Image

# ── Model constants ────────────────────────────────────────────────────────────
MODEL_URL = (
    "https://huggingface.co/deepghs/waifu2x_onnx/resolve/main/"
    "20230131/onnx_models/cunet/art/noise1_scale2x.onnx"
)
MODEL_DIR  = os.path.join(os.path.dirname(__file__), "models")
MODEL_PATH = os.path.join(MODEL_DIR, "waifu2x_noise1_scale2x.onnx")

# The cunet model crops 36px from each edge of the 2x output.
# Equivalently: pad input by 18px on each side before inference.
PAD       = 18          # px of reflect-padding added to each side of each tile
TILE_SIZE = 192         # tile width/height in original image pixels (before padding)
# Padded tile fed to model: (TILE_SIZE + 2*PAD) × (TILE_SIZE + 2*PAD)
# Model output per padded tile: (TILE_SIZE + 2*PAD)*2 - 72 = TILE_SIZE*2  ✓


def download_model() -> bool:
    """Download the waifu2x ONNX model if it isn't already present."""
    if os.path.exists(MODEL_PATH):
        return True
    os.makedirs(MODEL_DIR, exist_ok=True)
    try:
        import urllib.request
        sys.stderr.write("[upscale_worker] Downloading waifu2x model (~5 MB)…\n")
        sys.stderr.flush()
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        sys.stderr.write("[upscale_worker] Model ready.\n")
        sys.stderr.flush()
        return True
    except Exception as e:
        sys.stderr.write(f"[upscale_worker] Model download failed: {e}\n")
        sys.stderr.flush()
        return False


def load_session():
    """Load ONNX Runtime session. Returns (session, input_name) or (None, None)."""
    try:
        import onnxruntime as ort
        sess = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
        inp_name = sess.get_inputs()[0].name
        sys.stderr.write(f"[upscale_worker] ONNX session loaded. Input: {inp_name}\n")
        return sess, inp_name
    except Exception as e:
        sys.stderr.write(f"[upscale_worker] ONNX load failed: {e}\n")
        return None, None


# ── Tile-based 2× upscale ─────────────────────────────────────────────────────

def upscale_2x_onnx(sess, inp_name: str, arr: np.ndarray) -> np.ndarray:
    """
    Upscale an H×W×3 float32 array (values 0–1) by 2× using the cunet model.
    Handles arbitrary sizes via tile + reflect-pad.
    """
    H, W = arr.shape[:2]
    out_H, out_W = H * 2, W * 2
    output = np.zeros((out_H, out_W, 3), dtype=np.float32)
    weight = np.zeros((out_H, out_W), dtype=np.float32)

    # Pad the whole image for seamless tiling
    arr_pad = np.pad(arr, ((PAD, PAD), (PAD, PAD), (0, 0)), mode="reflect")

    ys = list(range(0, H, TILE_SIZE))
    xs = list(range(0, W, TILE_SIZE))

    for y in ys:
        for x in xs:
            # Tile bounds in original image space
            y1, y2 = y, min(y + TILE_SIZE, H)
            x1, x2 = x, min(x + TILE_SIZE, W)
            th, tw = y2 - y1, x2 - x1

            # Extract padded tile from padded image
            # arr_pad offset is (+PAD, +PAD) vs arr
            tile = arr_pad[y1 : y2 + 2 * PAD, x1 : x2 + 2 * PAD, :]  # (th+36, tw+36, 3)

            # NCHW float32
            t_in = tile.transpose(2, 0, 1)[np.newaxis].astype(np.float32)
            t_out = sess.run(None, {inp_name: t_in})[0]  # (1, 3, th*2, tw*2)
            t_out = t_out[0].transpose(1, 2, 0).clip(0, 1)  # (th*2, tw*2, 3)

            oy1, oy2 = y1 * 2, y2 * 2
            ox1, ox2 = x1 * 2, x2 * 2
            output[oy1:oy2, ox1:ox2] += t_out[:th * 2, :tw * 2]
            weight[oy1:oy2, ox1:ox2] += 1.0

    # Normalise (handles overlap weights)
    output /= np.maximum(weight[:, :, np.newaxis], 1e-6)
    return output.clip(0, 1)


def upscale_2x_lanczos(arr: np.ndarray) -> np.ndarray:
    """Fallback 2× upscale using Pillow LANCZOS (float32 0–1, HW3)."""
    img = Image.fromarray((arr * 255).clip(0, 255).astype(np.uint8), "RGB")
    img2 = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
    return np.array(img2, dtype=np.float32) / 255.0


# ── Main upscale function ─────────────────────────────────────────────────────

def upscale_image(sess, inp_name, input_path: str, scale: int, output_path: str):
    """Full pipeline: load PNG → separate alpha → upscale → restore alpha → save."""
    img = Image.open(input_path).convert("RGBA")
    rgb  = np.array(img, dtype=np.float32)[:, :, :3] / 255.0
    alpha = np.array(img, dtype=np.float32)[:, :, 3] / 255.0

    passes = 1 if scale == 2 else 2  # 4× = two 2× passes

    for _ in range(passes):
        if sess is not None:
            rgb = upscale_2x_onnx(sess, inp_name, rgb)
        else:
            rgb = upscale_2x_lanczos(rgb)

        # Upscale alpha with high-quality Lanczos (preserves sharp edges)
        H, W = rgb.shape[:2]
        alpha_img = Image.fromarray((alpha * 255).clip(0, 255).astype(np.uint8), "L")
        alpha_img = alpha_img.resize((W, H), Image.LANCZOS)
        alpha = np.array(alpha_img, dtype=np.float32) / 255.0

    # Composite back to RGBA
    out_rgb   = (rgb   * 255).clip(0, 255).astype(np.uint8)
    out_alpha = (alpha * 255).clip(0, 255).astype(np.uint8)
    out_arr = np.dstack([out_rgb, out_alpha])
    Image.fromarray(out_arr, "RGBA").save(output_path, "PNG")


# ── Worker loop ───────────────────────────────────────────────────────────────

def main():
    model_ok = download_model()
    sess, inp_name = (load_session() if model_ok else (None, None))
    backend = "waifu2x" if sess is not None else "lanczos"

    # Signal readiness to the Node.js parent
    sys.stdout.write(json.dumps({"ready": True, "backend": backend}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        req_id = req.get("id", "?")
        try:
            input_path  = req["input_path"]
            output_path = req["output_path"]
            scale       = int(req.get("scale", 4))
            if scale not in (2, 4):
                scale = 4
            upscale_image(sess, inp_name, input_path, scale, output_path)
            sys.stdout.write(json.dumps({"id": req_id, "output_path": output_path}) + "\n")
        except Exception:
            sys.stdout.write(json.dumps({"id": req_id, "error": traceback.format_exc()}) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
