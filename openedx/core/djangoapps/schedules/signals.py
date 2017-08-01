import datetime
import logging

from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from course_modes.models import CourseMode
from courseware.models import DynamicUpgradeDeadlineConfiguration, CourseDynamicUpgradeDeadlineConfiguration
from openedx.core.djangoapps.content.course_overviews.models import CourseOverview
from student.models import CourseEnrollment
from .models import Schedule

log = logging.getLogger(__name__)


def get_upgrade_deadline(enrollment):
    """ Returns the upgrade deadline for the given enrollment.

    The deadline is determined based on the following data (in priority order):
        1. Course run-specific deadline configuration (CourseDynamicUpgradeDeadlineConfiguration)
        2. Global deadline configuration (DynamicUpgradeDeadlineConfiguration)
        3. Verified course mode expiration
        4. Course end date
    """
    course_key = enrollment.course_id
    course_overview = CourseOverview.get_from_id(course_key)
    deadline = course_overview.end

    try:
        verified_mode = CourseMode.verified_mode_for_course(course_key)
        if verified_mode:
            deadline = verified_mode.expiration_datetime
    except CourseMode.DoesNotExist:
        pass

    global_config = DynamicUpgradeDeadlineConfiguration.current()
    if global_config.enabled:
        delta = global_config.deadline_days

        # Check if the given course has opted out of the feature
        course_config = CourseDynamicUpgradeDeadlineConfiguration.current(course_key)
        if course_config.enabled:
            if course_config.opt_out:
                return deadline

            delta = course_config.deadline_days

        # This represents the first date at which the learner can access the content. This will be the latter of
        # either the enrollment date or the course's start date.
        content_availability_date = max(enrollment.created, course_overview.start)
        user_deadline = content_availability_date + datetime.timedelta(days=delta)

        # If the deadline from above is None, make sure we have a value for comparison
        deadline = deadline or datetime.date.max

        # The user-specific deadline should never occur after the verified mode's expiration date, if one is set.
        deadline = min(deadline, user_deadline)

    return deadline


@receiver(post_save, sender=CourseEnrollment, dispatch_uid='create_schedule_for_enrollment')
def create_schedule(sender, **kwargs):
    if kwargs['created']:
        # TODO Check for existing enrollment?
        enrollment = kwargs['instance']
        upgrade_deadline = get_upgrade_deadline(enrollment)
        Schedule.objects.create(enrollment=enrollment, start=timezone.now(), upgrade_deadline=upgrade_deadline)
