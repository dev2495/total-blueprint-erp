from .settings import *  # noqa: F401,F403


_SCRIPT_APP_EXCLUDE = {
    "django.contrib.admin",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django_filters",
    "corsheaders",
    "rest_framework_simplejwt.token_blacklist",
}

INSTALLED_APPS = [app for app in INSTALLED_APPS if app not in _SCRIPT_APP_EXCLUDE]  # type: ignore[name-defined]

MIDDLEWARE = [  # type: ignore[name-defined]
    middleware
    for middleware in MIDDLEWARE
    if middleware != "django.contrib.messages.middleware.MessageMiddleware"
]
