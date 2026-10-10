"""Normalise photographed document pages (outward documents, future page kinds).

Same contract as the inward bill upload (apps/gate/bill_serializers.py):
JPEG/PNG/WebP up to 10 MiB, at least 320 px on the short edge, at most
40 million pixels; EXIF orientation applied, longest edge ≤ 2400 px, stored
as a JPEG of at most 2 MiB with its SHA-256. The inward serializer keeps its
own copy so inward behaviour never changes when this module evolves.
"""
import hashlib
import io
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework import serializers

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_STORED_BYTES = 2 * 1024 * 1024
MAX_PIXELS = 40_000_000
MIN_EDGE = 320
LONG_EDGE = 2400
FORMATS = {"JPEG", "PNG", "WEBP"}


def normalise_page(uploaded, *, noun="page"):
    """Return {data, width, height, byte_size, sha256} for one uploaded image."""
    if uploaded.size > MAX_UPLOAD_BYTES:
        raise serializers.ValidationError(f"Each {noun} photo must be 10 MiB or smaller.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = Image.open(uploaded)
            if image.format not in FORMATS or image.width * image.height > MAX_PIXELS or min(image.size) < MIN_EDGE:
                raise ValueError()
            image.load()
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.thumbnail((LONG_EDGE, LONG_EDGE), Image.Resampling.LANCZOS)
            for quality in [92, 88, 84]:
                output = io.BytesIO()
                image.save(output, format="JPEG", quality=quality, optimize=True)
                data = output.getvalue()
                if len(data) <= MAX_STORED_BYTES:
                    break
            else:
                raise ValueError()
            return {"data": data, "width": image.width, "height": image.height, "byte_size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise serializers.ValidationError(f"Use a clear JPEG, PNG or WebP {noun} photo, 320 px or larger, up to 40 million pixels. Convert HEIC/PDF to JPEG first.")


def normalise_pages(images, *, noun="page"):
    return [normalise_page(uploaded, noun=noun) for uploaded in images]


def page_fingerprint(pages):
    """Hash-only description of normalised pages for idempotency fingerprints."""
    return [{key: page[key] for key in ["sha256", "width", "height", "byte_size"]} for page in pages]


def content_hash(pages):
    return hashlib.sha256("|".join(page["sha256"] for page in pages).encode()).hexdigest()
