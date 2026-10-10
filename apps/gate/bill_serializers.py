import hashlib
import io
import re
import threading
import unicodedata
import warnings
from decimal import Decimal

from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework import serializers

from .models import DOCUMENT_CATEGORIES, DOCUMENT_TYPES
from .serializers import ActionInputSerializer

# Stored page contract (shared by gate photos, office photos and rendered PDF pages).
PAGE_MAX_EDGE = 2400
PAGE_MIN_EDGE = 320
PAGE_MAX_BYTES = 2 * 1024 * 1024
IMAGE_MAX_PIXELS = 40_000_000
IMAGE_MAX_BYTES = 10 * 1024 * 1024
PDF_MAX_BYTES = 15 * 1024 * 1024
PDF_RENDER_DPI = 200
OFFICE_MAX_PAGES = 20
OFFICE_MAX_FILES = 20
GATE_IMAGE_ERROR = "Use a clear JPEG, PNG or WebP bill image, 320 px or larger, up to 40 million pixels. Convert HEIC/PDF to JPEG first."
OFFICE_IMAGE_ERROR = "Use a clear JPEG, PNG or WebP photo (320 px or larger, up to 40 million pixels) or a PDF. Convert HEIC photos to JPEG first."

# PDFium is not thread-safe; gunicorn gthread workers share one process.
_PDFIUM_LOCK = threading.Lock()


def encode_page(image, qualities=(92, 88, 84)):
    """Normalise an upright PIL image into the stored JPEG page dict."""
    image = image.convert("RGB")
    image.thumbnail((PAGE_MAX_EDGE, PAGE_MAX_EDGE), Image.Resampling.LANCZOS)
    for quality in qualities:
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=quality, optimize=True)
        data = output.getvalue()
        if len(data) <= PAGE_MAX_BYTES:
            break
    else:
        raise ValueError("Page is too detailed to store.")
    return {"data": data, "width": image.width, "height": image.height, "byte_size": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def normalise_uploaded_image(uploaded, message=GATE_IMAGE_ERROR):
    """Validate one uploaded photo and return the stored page dict (EXIF-upright, metadata removed)."""
    if uploaded.size > IMAGE_MAX_BYTES:
        raise serializers.ValidationError("Each bill image must be 10 MiB or smaller.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = Image.open(uploaded)
            if image.format not in {"JPEG", "PNG", "WEBP"} or image.width * image.height > IMAGE_MAX_PIXELS or min(image.size) < PAGE_MIN_EDGE:
                raise ValueError()
            image.load()
            image = ImageOps.exif_transpose(image).convert("RGB")
            return encode_page(image)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise serializers.ValidationError(message)


def safe_file_name(name, fallback="document.pdf"):
    """Printable, path-free file name kept with the original evidence."""
    base = str(name or "").replace("\\", "/").rsplit("/", 1)[-1]
    base = "".join(ch for ch in unicodedata.normalize("NFC", base) if ch.isprintable() and ch not in '"<>|*?:')
    base = re.sub(r"\s+", " ", base).strip(" .")
    return (base or fallback)[:255]


def _pdf_error(name, message):
    return serializers.ValidationError(f"{name}: {message}")


def render_pdf(uploaded, remaining_pages):
    """Render every page of an office PDF to a stored JPEG page (about 200 DPI, 2400 px cap).

    Returns (pages, original) where ``original`` is the immutable original file
    dict. Refuses password-protected, damaged, empty or oversized documents.
    """
    import pypdfium2 as pdfium

    name = safe_file_name(getattr(uploaded, "name", ""))
    if uploaded.size > PDF_MAX_BYTES:
        raise _pdf_error(name, "each PDF must be 15 MiB or smaller.")
    uploaded.seek(0)
    data = uploaded.read()
    if b"%PDF-" not in data[:1024]:
        raise _pdf_error(name, "this is not a PDF file. Upload a PDF or a JPEG/PNG/WebP photo.")
    pages = []
    with _PDFIUM_LOCK:
        try:
            document = pdfium.PdfDocument(data)
        except pdfium.PdfiumError as exc:
            if getattr(exc, "err_code", None) == pdfium.raw.FPDF_ERR_PASSWORD:
                raise _pdf_error(name, "the PDF is password-protected. Ask the sender for an unlocked copy, or print it to a new PDF without a password.")
            raise _pdf_error(name, "the PDF is damaged or unreadable. Download or export it again and retry.")
        try:
            count = len(document)
            if count < 1:
                raise _pdf_error(name, "the PDF has no pages.")
            if count > remaining_pages:
                raise serializers.ValidationError(f"Upload up to {OFFICE_MAX_PAGES} pages in total per document; {name} has {count} page{'s' if count != 1 else ''} and only {max(remaining_pages, 0)} more fit.")
            for index in range(count):
                page = document[index]
                try:
                    width_pt, height_pt = page.get_size()
                    if min(width_pt, height_pt) <= 0:
                        raise _pdf_error(name, f"page {index + 1} has no printable area.")
                    scale = PDF_RENDER_DPI / 72
                    if max(width_pt, height_pt) * scale > PAGE_MAX_EDGE:
                        scale = PAGE_MAX_EDGE / max(width_pt, height_pt)
                    if min(width_pt, height_pt) * scale < PAGE_MIN_EDGE:
                        scale = PAGE_MIN_EDGE / min(width_pt, height_pt)
                    if max(width_pt, height_pt) * scale > 4 * PAGE_MAX_EDGE:
                        raise _pdf_error(name, f"page {index + 1} has an unusual shape (a very long strip). Export it as an image instead.")
                    bitmap = page.render(scale=scale, fill_color=(255, 255, 255, 255))
                    try:
                        image = bitmap.to_pil()
                        image.load()
                    finally:
                        bitmap.close()
                finally:
                    page.close()
                try:
                    pages.append(encode_page(image, qualities=(90, 86, 82, 78, 72, 66)))
                except ValueError:
                    raise _pdf_error(name, f"page {index + 1} is too detailed to store. Export it at a lower resolution and retry.")
        except pdfium.PdfiumError:
            raise _pdf_error(name, "a page could not be rendered. Download or export the PDF again and retry.")
        finally:
            document.close()
    original = {
        "file_name": name if name.lower().endswith(".pdf") else f"{name}.pdf",
        "content_type": "application/pdf",
        "byte_size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "page_count": len(pages),
        "data": data,
    }
    return pages, original


def is_pdf_upload(uploaded):
    content_type = str(getattr(uploaded, "content_type", "") or "").lower()
    name = str(getattr(uploaded, "name", "") or "").lower()
    if content_type == "application/pdf" or name.endswith(".pdf"):
        return True
    uploaded.seek(0)
    head = uploaded.read(8)
    uploaded.seek(0)
    return head.startswith(b"%PDF-")


class BillUploadSerializer(ActionInputSerializer):
    plant = serializers.UUIDField()
    images = serializers.ListField(child=serializers.FileField(), min_length=1, max_length=6, write_only=True)

    def validate_images(self, images):
        return [normalise_uploaded_image(uploaded) for uploaded in images]


def money_field():
    return serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0"), required=False, allow_null=True)


class DocumentHeaderSerializer(serializers.Serializer):
    """Office-entered paper header. Absent fields stay unchanged."""
    doc_type = serializers.ChoiceField(choices=[code for code, _ in DOCUMENT_TYPES], required=False, allow_blank=True)
    category = serializers.ChoiceField(choices=[code for code, _ in DOCUMENT_CATEGORIES], required=False, allow_blank=True)
    vendor_id = serializers.UUIDField(required=False, allow_null=True)
    party_name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    invoice_number = serializers.CharField(max_length=80, required=False, allow_blank=True)
    invoice_date = serializers.DateField(required=False, allow_null=True)
    taxable_amount = money_field()
    tax_amount = money_field()
    total_amount = money_field()
    due_date = serializers.DateField(required=False, allow_null=True)
    valid_until = serializers.DateField(required=False, allow_null=True)
    ship_to_plant = serializers.UUIDField(required=False, allow_null=True)
    notes = serializers.CharField(max_length=500, required=False, allow_blank=True)


HEADER_FIELDS = tuple(DocumentHeaderSerializer().fields)


class OfficeUploadSerializer(ActionInputSerializer, DocumentHeaderSerializer):
    plant = serializers.UUIDField()
    files = serializers.ListField(child=serializers.FileField(), min_length=1, max_length=OFFICE_MAX_FILES, write_only=True)

    def validate_files(self, files):
        pages, originals = [], []
        for uploaded in files:
            remaining = OFFICE_MAX_PAGES - len(pages)
            if is_pdf_upload(uploaded):
                rendered, original = render_pdf(uploaded, remaining)
                original["first_page"] = len(pages) + 1
                pages.extend(rendered)
                originals.append(original)
            else:
                if remaining < 1:
                    raise serializers.ValidationError(f"Upload up to {OFFICE_MAX_PAGES} pages in total per document.")
                pages.append(normalise_uploaded_image(uploaded, OFFICE_IMAGE_ERROR))
        return {"pages": pages, "originals": originals}


class BillClassifySerializer(ActionInputSerializer, DocumentHeaderSerializer):
    header_version = serializers.IntegerField(min_value=0)

    def validate(self, data):
        if not set(data) & set(HEADER_FIELDS):
            raise serializers.ValidationError("Choose a document field to save.")
        return data


class BillFileSerializer(ActionInputSerializer):
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True)
    duplicate_override_reason = serializers.CharField(min_length=5, max_length=500, required=False)
    original_invoice_ref = serializers.CharField(max_length=80, required=False, allow_blank=True)
    header_version = serializers.IntegerField(min_value=0, required=False)


class BillAttachSerializer(ActionInputSerializer):
    target_bill_id = serializers.UUIDField()
    reason = serializers.CharField(min_length=5, max_length=500)


class BillReasonSerializer(ActionInputSerializer):
    reason = serializers.CharField(min_length=5, max_length=500)


class BillReviewSerializer(ActionInputSerializer):
    vendor_id = serializers.UUIDField(required=False)
    invoice_number = serializers.CharField(max_length=80, required=False, allow_blank=True)
    invoice_date = serializers.DateField(required=False, allow_null=True)
    vehicle_number = serializers.CharField(max_length=40, required=False, allow_blank=True)
    purchase_order_id = serializers.UUIDField(required=False)
    notes = serializers.CharField(max_length=500, required=False, allow_blank=True)

    def validate(self, data):
        if len(data) == 1:
            raise serializers.ValidationError("Choose a review field to save.")
        return data


class ReceiptRefSerializer(serializers.Serializer):
    kind = serializers.CharField(max_length=16)
    id = serializers.UUIDField()

    def validate_kind(self, value):
        from .bill_services import receipt_kinds
        if value not in receipt_kinds():
            raise serializers.ValidationError("Choose a valid posted receipt kind.")
        return value


class BillFinishSerializer(ActionInputSerializer):
    reason = serializers.CharField(min_length=5, max_length=500)


class BillLinkSerializer(BillFinishSerializer):
    receipt_refs = ReceiptRefSerializer(many=True, min_length=1, max_length=100)
    bill_complete = serializers.BooleanField(default=False)


# NON_STOCK stays readable on old voids; new non-stock paper is filed or receipted.
VOID_CODES = ["DUPLICATE", "UNREADABLE", "CANCELLED", "NOT_OUR_DOCUMENT", "NON_STOCK"]


class BillVoidSerializer(BillFinishSerializer):
    resolution_code = serializers.ChoiceField(choices=VOID_CODES)
    duplicate_of = serializers.UUIDField(required=False)

    def validate(self, data):
        if data["resolution_code"] == "NON_STOCK":
            raise serializers.ValidationError({"resolution_code": "Non-stock paper is no longer voided. Record a General Receipt for spares, machinery or services, or File it as a record (utility, fee, transport, note)."})
        if (data["resolution_code"] == "DUPLICATE") != bool(data.get("duplicate_of")):
            raise serializers.ValidationError("Duplicate resolution requires the other document it repeats; other resolutions cannot specify duplicate_of.")
        return data
