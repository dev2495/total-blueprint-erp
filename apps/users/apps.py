from django.apps import AppConfig


class UsersConfig(AppConfig):
    name = 'apps.users'

    def ready(self):
        # Request-wide API policy: a failed mutation never commits partially.
        from config.api_transactions import install

        install()
