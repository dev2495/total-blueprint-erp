from django.urls import path, include
from config.routers import OptionalSlashRouter
from .views import (
    ChangePasswordView,
    CsrfCookieView,
    CookieTokenRefreshView,
    LogoutView,
    MyTokenObtainPairView,
    NotificationViewSet,
    ProfileChangeRequestViewSet,
    RoleViewSet,
    UserViewSet,
)

router = OptionalSlashRouter()
router.register(r'users', UserViewSet)
router.register(r'roles', RoleViewSet)
router.register(r'notifications', NotificationViewSet, basename='notifications')
router.register(r'profile-change-requests', ProfileChangeRequestViewSet, basename='profile-change-requests')

urlpatterns = [
    path('csrf/', CsrfCookieView.as_view(), name='csrf_cookie'),
    path('login/', MyTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('token/refresh/', CookieTokenRefreshView.as_view(), name='token_refresh'),
    path('logout/', LogoutView.as_view(), name='logout'),
    path('change-password/', ChangePasswordView.as_view(), name='change-password'),
    path('me/', UserViewSet.as_view({'get': 'me'}), name='me'),
    path('', include(router.urls)),
]
