"""Validation for every artwork upload alias before files reach storage."""
from pathlib import Path
import warnings

from django.conf import settings
from PIL import Image
from pypdf import PdfReader
from rest_framework.exceptions import ValidationError


ARTWORK_TYPES = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf'}


def validate_artwork_upload(upload):
    extension = Path(upload.name).suffix.lower()
    if extension not in ARTWORK_TYPES:
        raise ValidationError('Artwork must be a JPG, PNG or PDF file.')
    if upload.size > getattr(settings, 'ARTWORK_MAX_UPLOAD_BYTES', 20 * 1024 * 1024):
        raise ValidationError('Artwork files must be no larger than 20 MB.')
    try:
        upload.seek(0)
        if extension == '.pdf':
            if not upload.read(5) == b'%PDF-':
                raise ValueError('Invalid PDF header')
            upload.seek(0)
            reader = PdfReader(upload, strict=True)
            if reader.is_encrypted or not len(reader.pages):
                raise ValueError('Encrypted or empty PDF')
        else:
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                with Image.open(upload) as picture:
                    expected = 'PNG' if extension == '.png' else 'JPEG'
                    if picture.format != expected:
                        raise ValueError('Image format does not match extension')
                    picture.verify()
    except Exception as exc:
        raise ValidationError('The artwork file is corrupt, unsupported or unsafe to preview.') from exc
    finally:
        upload.seek(0)
    return upload
