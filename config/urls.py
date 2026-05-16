"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
import os
from pathlib import Path

from django.conf import settings
from django.urls import include, path
from django.views.decorators.clickjacking import xframe_options_exempt
from django.views.static import serve
from .views import health_check, health_live, health_ready


@xframe_options_exempt
def artwork_media_serve(request, path):
    return serve(request, path, document_root=Path(settings.MEDIA_ROOT) / 'artworks')


urlpatterns = [
    path('api/health/live/', health_live, name='health-live'),
    path('api/health/ready/', health_ready, name='health-ready'),
    path('api/health/', health_check, name='health-check'),

    # 1. Canonical Master Data APIs
    path('api/master/', include('apps.materials.urls')), # Fix for frontend master-data.ts
    path('api/recipes/', include('apps.recipes.urls')),  # Fix for missing recipes/grades endpoint

    # Fallback/Direct access (Optional but kept for now)
    path('api/films/', include('apps.materials.urls_films')),
    path('api/addons/', include('apps.materials.urls_addons')),
    path('api/inks/', include('apps.materials.urls_inks')),
    path('api/adhesives/', include('apps.materials.urls_adhesives')),
    path('api/solvents/', include('apps.materials.urls_solvents')),
    
    # 2. Engineering & Templates
    path('api/templates/', include('apps.templates.urls')),
    path('api/routing/', include('apps.routing.urls')),
    path('api/engineering/', include('apps.artwork.urls')),
    path('api/tooling/', include('apps.tooling.urls')),
    
    # 3. Sales & Orders
    path('api/sales/', include('apps.sales.urls_canonical')),
    
    # Legacy / App specific fallbacks
    path('api/auth/', include('apps.users.urls')),
    path('api/users/', include('apps.users.urls')),
    path('api/dashboard/', include('apps.dashboard.urls')),
    path('api/analytics/', include('apps.analytics.urls')),
    path('api/factory/', include('apps.factory.urls')),
    path('api/production/', include('apps.production.urls')),
    path('api/inventory/', include('apps.inventory.urls')),
    path('api/mrp/', include('apps.mrp.urls')),
    path('api/costing/', include('apps.costing.urls')),
    path('api/ops/', include('apps.platformops.urls')),
    path('media/artworks/<path:path>', artwork_media_serve),
]

if os.getenv("SKIP_ADMIN_APP_IMPORT") != "1":
    from django.contrib import admin

    urlpatterns.insert(3, path('admin/', admin.site.urls))
