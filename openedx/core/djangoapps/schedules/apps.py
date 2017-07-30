"""
Schedules Application Configuration

Signal handlers are connected here.
"""

from django.apps import AppConfig


class SchedulesConfig(AppConfig):
    """
    Application Configuration for Schedules.
    """
    name = u'openedx.core.djangoapps.schedules'

    def ready(self):
        """
        Connect signal handlers.
        """
        from . import handlers  # pylint: disable=unused-variable
