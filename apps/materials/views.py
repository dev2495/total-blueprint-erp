from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from .models import CommercialFamily, InventoryMaterial, PodSku, PodSkuVariant
from apps.inventory.models import InkMaterial
from .serializers import (
    FilmFamilySerializer, 
    FilmVariantSerializer, 
    GranuleSerializer, 
    InkSerializer, 
    AdhesiveSolventSerializer,
    AddonSerializer,
    PODSerializer,
    PodSkuSerializer,
    PodSkuVariantSerializer,
    InventoryMaterialSerializer,
    PackagingSerializer,
    CommercialFamilySerializer,
)

class MaterialLibraryViewSet(viewsets.ReadOnlyModelViewSet):
    """Unified read-only library for BOM selection across all categories"""
    queryset = InventoryMaterial.objects.all().order_by('category', 'name')
    serializer_class = InventoryMaterialSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['category', 'is_extrudable']
    search_fields = ['name', 'code']


class CommercialFamilyViewSet(viewsets.ModelViewSet):
    queryset = CommercialFamily.objects.all().order_by('name')
    serializer_class = CommercialFamilySerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['default_form', 'default_reporting_group', 'active']
    search_fields = ['name', 'code']


class PODViewSet(viewsets.ModelViewSet):
    queryset = InventoryMaterial.objects.filter(category='POD').order_by('name')
    serializer_class = PODSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['name', 'code']

    def perform_update(self, serializer):
        instance = serializer.instance
        if instance.code.startswith('POD-'):
            from rest_framework.exceptions import ValidationError
            immutable = {}
            if 'code' in serializer.validated_data and serializer.validated_data.get('code') != instance.code:
                immutable['code'] = "Core POD code cannot be changed."
            if 'category' in serializer.validated_data and serializer.validated_data.get('category') != instance.category:
                immutable['category'] = "Core POD category cannot be changed."
            if 'base_uom' in serializer.validated_data and serializer.validated_data.get('base_uom') != instance.base_uom:
                immutable['base_uom'] = "Core POD base_uom cannot be changed."
            if immutable:
                raise ValidationError(immutable)
        serializer.save()

    def perform_destroy(self, instance):
        if instance.code.startswith('POD-'):
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Core POD materials cannot be deleted.")
        instance.delete()


class FilmFamilyViewSet(viewsets.ModelViewSet):
    queryset = InventoryMaterial.objects.filter(category='FILM_FAMILY').order_by('name')
    serializer_class = FilmFamilySerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['name']

class FilmVariantViewSet(viewsets.ModelViewSet):
    queryset = InventoryMaterial.objects.filter(category='FILM_VARIANT').order_by('name')
    serializer_class = FilmVariantSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['parent_family', 'is_extrudable']
    search_fields = ['name', 'code']
    @action(detail=False, methods=['get'])
    def grades(self, request):
        from apps.recipes.models import RecipeGrade
        # If variant_id is provided in query params, we could filter, 
        # but the request is for global grades from master.
        variant_id = request.query_params.get('variant_id')
        grades = RecipeGrade.objects.all()
        return Response([{"id": str(g.id), "name": g.name} for g in grades])

class GranuleViewSet(viewsets.ModelViewSet):
    queryset = InventoryMaterial.objects.filter(category='GRANULE').order_by('name')
    serializer_class = GranuleSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['name', 'code']

class InkViewSet(viewsets.ModelViewSet):
    queryset = InkMaterial.objects.all().order_by('color_name')
    serializer_class = InkSerializer
    filter_backends = [filters.SearchFilter, DjangoFilterBackend]
    filterset_fields = ['base_type']
    search_fields = ['color_name', 'code', 'name']
    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except Exception as e:
            if "unique constraint" in str(e).lower() or "integrity" in str(e).lower():
                from rest_framework.exceptions import ValidationError
                raise ValidationError({"detail": f"Ink with this Base Type and Color Name already exists."})
            raise e

class AdhesiveSolventViewSet(viewsets.ModelViewSet):
    """
    Combined viewset for Adhesives and Solvents as they are often managed together in lamination.
    """
    queryset = InventoryMaterial.objects.filter(category__in=['ADHESIVE', 'SOLVENT']).order_by('category', 'name')
    serializer_class = AdhesiveSolventSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['category']
    search_fields = ['name', 'code']

class AddonViewSet(viewsets.ModelViewSet):
    queryset = InventoryMaterial.objects.filter(category='ADDON').order_by('name')
    serializer_class = AddonSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['name', 'code']


class PackagingViewSet(viewsets.ModelViewSet):
    queryset = InventoryMaterial.objects.filter(category='PACKAGING').order_by('name')
    serializer_class = PackagingSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['packaging_kind', 'packaging_supply_mode', 'base_uom', 'status']
    search_fields = ['name', 'code']


class PodSkuViewSet(viewsets.ModelViewSet):
    queryset = PodSku.objects.prefetch_related('variants__material').order_by('name', 'code')
    serializer_class = PodSkuSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['active', 'family']
    search_fields = ['name', 'code', 'family']


class PodSkuVariantViewSet(viewsets.ModelViewSet):
    serializer_class = PodSkuVariantSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['active', 'pod_sku', 'material']
    search_fields = ['name', 'code', 'pod_sku__name', 'pod_sku__code', 'material__name', 'material__code']

    def get_queryset(self):
        queryset = PodSkuVariant.objects.select_related('pod_sku', 'material').order_by('pod_sku__name', 'name', 'code')
        pod_sku_id = str(
            self.request.query_params.get('pod_sku')
            or self.request.query_params.get('pod_sku_id')
            or ''
        ).strip()
        if pod_sku_id:
            queryset = queryset.filter(pod_sku_id=pod_sku_id)
        return queryset
