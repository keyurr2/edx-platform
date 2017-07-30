from __future__ import print_function

import datetime

from dateutil.tz import tzutc
from django.core.management.base import BaseCommand, CommandError

from openedx.core.djangoapps.schedules.models import Schedule
from openedx.core.djangoapps.schedules.tasks import send_email_batch


class Command(BaseCommand):

    def add_arguments(self, parser):
        parser.add_argument('--date', default=datetime.datetime.utcnow().date().isoformat())

    def handle(self, *args, **options):
        current_date = datetime.date(*[int(x) for x in options['date'].split('-')])
        target_date = current_date - datetime.timedelta(days=1)

        self.send_verified_upgrade_reminder(target_date, 20)

    def send_verified_upgrade_reminder(self, target_date, days_before_deadline):
        deadline_date = target_date + datetime.timedelta(days=days_before_deadline)
        deadline_date_range = (
            datetime.datetime(deadline_date.year, deadline_date.month, deadline_date.day, 0, 0, tzinfo=tzutc()),
            datetime.datetime(deadline_date.year, deadline_date.month, deadline_date.day, 23, 59, 59, 999999, tzinfo=tzutc())
        )
        schedules = Schedule.objects.filter(upgrade_deadline__range=deadline_date_range, active=True).order_by('enrollment__course_id')
        print(schedules.query.sql_with_params())

        for schedule_ids in batch_iterator([s.pk for s in schedules], 500):
            send_email_batch(SailthruEmailBatch(schedule_ids, 'This is a subject', 'Verified Upgrade Reminder -2 days'))


def batch_iterator(iterable, batch_size):
    iterator = iter(iterable)

    while True:
        batch = list(itertools.islice(iterator, batch_size))
        if len(batch) == 0:
            break

        yield batch


from collections import namedtuple

from django.conf import settings
from django.core.urlresolvers import reverse

from openedx.core.djangoapps.content.course_overviews.models import CourseOverview
from lms.djangoapps.courseware.views.views import get_cosmetic_verified_display_price

from course_modes.models import CourseMode
from lms.djangoapps.commerce.utils import EcommerceService


def get_upgrade_link(enrollment):
    user = enrollment.user
    course_id = enrollment.course_id

    if not enrollment.is_active:
        return None

    if enrollment.mode not in CourseMode.UPSELL_TO_VERIFIED_MODES:
        return None

    ecommerce_service = EcommerceService()
    if ecommerce_service.is_enabled(user):
        course_mode = CourseMode.objects.get(
            course_id=course_id, mode_slug=CourseMode.VERIFIED
        )
        return ecommerce_service.get_checkout_page_url(course_mode.sku)
    return reverse('verify_student_upgrade_and_verify', args=(course_id,))


def build_email_context(schedule_ids):
    schedules = Schedule.objects.select_related('enrollment__user__profile').filter(id__in=schedule_ids)

    context = {}
    course_cache = {}
    for schedule in schedules:
        enrollment = schedule.enrollment
        user = enrollment.user

        course_id_str = str(enrollment.course_id)
        course = course_cache.get(course_id_str)
        if course is None:
            course = CourseOverview.get_from_id(enrollment.course_id)
            course_cache[course_id_str] = course

        course_root = reverse('course_root', kwargs={'course_id': course_id_str})

        def absolute_url(relative_path):
            return u'{}{}'.format(settings.LMS_ROOT_URL, relative_path)

        context[user.email] = {
            'user_full_name': user.profile.name,
            'user_username': user.username,
            'user_schedule_start_time': schedule.start,
            'user_schedule_verified_upgrade_deadline_time': schedule.upgrade_deadline,
            'course_id': course_id_str,
            'course_title': course.display_name,
            'course_url': absolute_url(course_root),
            'course_image_url': absolute_url(course.course_image_url),
            'course_end_time': course.end,
            'course_verified_upgrade_url': get_upgrade_link(enrollment),
            'course_verified_upgrade_price': get_cosmetic_verified_display_price(course),
        }

    return context


from sailthru.sailthru_client import SailthruClient
import itertools
import time


class SailthruEmailBatch(namedtuple('_SailthruEmailBatchBase', ['schedule_ids', 'subject', 'template_name'])):

    def send(self):
        email_context = build_email_context(self.schedule_ids)
        print(email_context)

        if not hasattr(settings, 'SAILTHRU_API_KEY') or not hasattr(settings, 'SAILTHRU_API_SECRET'):
            return

        sailthru_client = SailthruClient(settings.SAILTHRU_API_KEY, settings.SAILTHRU_API_SECRET)

        SAILTHRU_MAX_SEND_BATCH_SIZE = 100

        for batch_email_addresses in batch_iterator(email_context.keys(), SAILTHRU_MAX_SEND_BATCH_SIZE):
            self._wait_for_rate_limit(sailthru_client)

            batch_context = {k:email_context[k] for k in batch_email_addresses}
            response = sailthru_client.multi_send(
                self.template_name,
                batch_email_addresses,
                evars=batch_context,
            )
            if response.is_ok():
                body = response.get_body()
                sent_count = int(body.get("sent_count", 1))
            else:
                error = response.get_error()
                # print("Error: " + error.get_message())
                # print("Status Code: " + str(response.get_status_code()))
                # print("Error Code: " + str(error.get_error_code()))
                # print("Failed batch: {0}".format(json.dumps(emails)))

    def _wait_for_rate_limit(self, sailthru_client):
        rate_limit_info = sailthru_client.get_last_rate_limit_info('send', 'POST')
        if rate_limit_info is not None:
            remaining = int(rate_limit_info['remaining'])
            reset_timestamp = int(rate_limit_info['reset'])
            seconds_till_reset = reset_timestamp - time.time()
            if remaining <= 0 and seconds_till_reset > 0:
                print('Rate limit exceeded, sleeping for {0} seconds'.format(seconds_till_reset))
                time.sleep(seconds_till_reset + 1)
