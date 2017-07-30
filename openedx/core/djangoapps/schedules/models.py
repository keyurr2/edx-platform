from collections import namedtuple

from django.db import models
from django.utils.translation import ugettext_lazy as _
from django_extensions.db.fields import ModificationDateTimeField


class Schedule(models.Model):
    modified = ModificationDateTimeField(_('modified'))
    enrollment = models.OneToOneField('student.CourseEnrollment', null=False)
    active = models.BooleanField(default=True, help_text=_('Indicates if this schedule is actively enforced'))
    start = models.DateTimeField(help_text=_('Date this schedule went into effect'))
    upgrade_deadline = models.DateTimeField(
        null=False,
        help_text=_('Deadline by which the learner must upgrade to a verified seat')
    )

    class Meta(object):
        verbose_name = _('Schedule')
        verbose_name_plural = _('Schedules')
