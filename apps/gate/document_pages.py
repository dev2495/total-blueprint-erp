"""Shared helpers for private document page images (inward bills and outward documents).

Page bytes are immutable evidence. Readers may save a shared display rotation
(DocumentPageView) and request a small thumbnail rendered on the fly; neither
changes the stored image.
"""
import io

from django.db import transaction
from PIL import Image
from rest_framework import serializers
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.users.permission_service import PermissionService

from .models import DocumentPageView, InwardBillPage, OutwardDocumentPage
from .serializers import ActionInputSerializer

THUMB_WIDTHS = {160, 320, 640}
PAGE_KINDS = {"INWARD", "OUTWARD"}


def rotation_map(page_kind, page_ids):
    ids = [page_id for page_id in page_ids]
    if not ids:
        return {}
    return {str(row.page_id): row.display_rotation for row in DocumentPageView.objects.filter(page_kind=page_kind, page_id__in=ids)}


def serialize_pages(page_kind, pages, url_for):
    """Page dicts with private URLs, thumbnail URL and saved display rotation.

    ``pages`` should be loaded with ``.defer("data")``; ``url_for(page)`` returns
    the authenticated image URL for one page.
    """
    pages = list(pages)
    rotations = rotation_map(page_kind, [page.id for page in pages])
    rows = []
    for page in pages:
        url = url_for(page)
        rows.append({
            "id": str(page.id),
            "page_number": page.page_number,
            "width": page.width,
            "height": page.height,
            "byte_size": page.byte_size,
            "image_url": url,
            "thumb_url": f"{url}?w=320",
            "display_rotation": rotations.get(str(page.id), 0),
            "page_kind": page_kind,
        })
    return rows


def page_image_bytes(page, request):
    """Full JPEG, or a thumbnail when ``?w=160|320|640`` is requested."""
    raw = request.query_params.get("w") if request is not None else None
    data = bytes(page.data)
    if not raw:
        return data
    try:
        width = int(raw)
    except (TypeError, ValueError):
        raise ValidationError({"w": "Choose a thumbnail width of 160, 320 or 640."})
    if width not in THUMB_WIDTHS:
        raise ValidationError({"w": "Choose a thumbnail width of 160, 320 or 640."})
    if width >= page.width:
        return data
    image = Image.open(io.BytesIO(data))
    image.thumbnail((width, width * 4), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    image.convert("RGB").save(output, format="JPEG", quality=80, optimize=True)
    return output.getvalue()


class PageRotationSerializer(ActionInputSerializer):
    page_kind = serializers.ChoiceField(choices=sorted(PAGE_KINDS))
    page_id = serializers.UUIDField()
    rotation = serializers.ChoiceField(choices=[0, 90, 180, 270])


def _page_for_rotation(user, page_kind, page_id):
    if page_kind == "INWARD":
        if not (PermissionService.has_document_permission(user, "documents.view") or PermissionService.has_inventory_bill_review(user)):
            raise PermissionDenied("This account cannot change bill page views.")
        page = InwardBillPage.objects.defer("data").select_related("intake").filter(id=page_id).first()
    else:
        if not PermissionService.has_document_permission(user, "outward.reconcile"):
            raise PermissionDenied("This account cannot change outward page views.")
        page = OutwardDocumentPage.objects.defer("data").select_related("document").filter(id=page_id).first()
    if not page:
        raise NotFound("This page is unavailable.")
    return page


def save_page_rotation(user, data):
    """Upsert the shared display rotation of one page. Idempotent by value."""
    _page_for_rotation(user, data["page_kind"], data["page_id"])
    with transaction.atomic():
        view, _ = DocumentPageView.objects.select_for_update().get_or_create(
            page_kind=data["page_kind"], page_id=data["page_id"],
            defaults={"display_rotation": data["rotation"], "updated_by": user},
        )
        if view.display_rotation != data["rotation"]:
            view.display_rotation = data["rotation"]
            view.updated_by = user
            view.save(update_fields=["display_rotation", "updated_by", "updated_at"])
    return {"page_kind": data["page_kind"], "page_id": str(data["page_id"]), "display_rotation": data["rotation"]}


def rotation_response(request):
    from .views import validated

    return Response(save_page_rotation(request.user, validated(PageRotationSerializer, request.data)))
