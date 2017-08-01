from __future__ import print_function

import datetime
import textwrap

from dateutil.tz import tzutc, gettz
from django.core.management.base import BaseCommand
from django.utils.translation import ugettext_lazy
from django.utils.translation import override as override_language
from jinja2 import Environment, contextfilter, Markup, escape

from openedx.core.djangoapps.schedules.models import Schedule
from openedx.core.djangoapps.schedules.tasks import send_email_batch


class Command(BaseCommand):

    def add_arguments(self, parser):
        parser.add_argument('--date', default=datetime.datetime.utcnow().date().isoformat())

    def handle(self, *args, **options):
        current_date = datetime.date(*[int(x) for x in options['date'].split('-')])
        target_date = current_date - datetime.timedelta(days=1)

        self.send_verified_upgrade_reminder(target_date, 19)

    def send_verified_upgrade_reminder(self, target_date, days_before_deadline):
        deadline_date = target_date + datetime.timedelta(days=days_before_deadline)
        deadline_date_range = (
            datetime.datetime(deadline_date.year, deadline_date.month, deadline_date.day, 0, 0, tzinfo=tzutc()),
            datetime.datetime(deadline_date.year, deadline_date.month, deadline_date.day, 23, 59, 59, 999999, tzinfo=tzutc())
        )
        schedules = Schedule.objects.filter(upgrade_deadline__range=deadline_date_range, active=True).order_by('enrollment__course_id')
        print(schedules.query.sql_with_params())

        template = ugettext_lazy(
            # Translators: This is a verified upgrade deadline reminder. It is automatically sent to learners two days
            # before the deadline.
            textwrap.dedent(u"""
                Dear {{ user_personal_address }},
                <br/>
                We hope you are enjoying {{ course_title }}. Upgrade by {{ user_schedule_verified_upgrade_deadline_time|human_readable_time }} to get a shareable certificate!
                <br/>
                {{ course_verified_upgrade_url|call_to_action_button('Upgrade now') }}
            """).strip()
        )

        email_template = EmailTemplate(
            subject=ugettext_lazy('Only two days left to upgrade!'),
            content_template=template,
            preview_text=ugettext_lazy('Upgrade today!'),
        )
        for schedule_batch in batch_iterator(schedules, 500):
            batch = SailthruEmailBatch(
                schedule_ids=[s.pk for s in schedule_batch],
                email_template=email_template,
                sailthru_template_name='Verified Upgrade Reminder'
            )
            send_email_batch(batch)

    def send_weekly_update(self, target_date, week_number):
        pass


import itertools


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
from util.date_utils import strftime_localized


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


def build_email_context(schedule_ids, email_template):
    schedules = Schedule.objects.select_related('enrollment__user__profile').filter(id__in=schedule_ids)
    print(schedules.query.sql_with_params())

    context = {}
    course_cache = {}
    translated_template_cache = {}

    template_env = Environment()
    template_env.filters['human_readable_time'] = human_readable_time
    template_env.filters['call_to_action_button'] = call_to_action_button

    for schedule in schedules:
        enrollment = schedule.enrollment
        user = enrollment.user

        user_time_zone = tzutc()
        for preference in user.preferences.all():
            if preference.key == 'time_zone':
                user_time_zone = gettz(preference.value)

        course_id_str = str(enrollment.course_id)
        course = course_cache.get(course_id_str)
        if course is None:
            course = CourseOverview.get_from_id(enrollment.course_id)
            course_cache[course_id_str] = course

        course_root = reverse('course_root', kwargs={'course_id': course_id_str})

        def absolute_url(relative_path):
            return u'{}{}'.format(settings.LMS_ROOT_URL, relative_path)

        template_context = {
            'user_full_name': user.profile.name,
            'user_personal_address': user.profile.name if user.profile.name else user.username,
            'user_username': user.username,
            'user_time_zone': user_time_zone,
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

        with override_language(course.language):
            translated_template = translated_template_cache.get(course.language)
            if not translated_template:
                translated_template = template_env.from_string(unicode(email_template.content_template))
                translated_template_cache[course.language] = translated_template

            email_context = {
                'template_subject': unicode(email_template.subject),
                'template_preview_text': unicode(email_template.preview_text),
                'template_body': translated_template.render(template_context),
                'template_from': template_context['course_title'],
            }

        context[user.email] = email_context

    return context


@contextfilter
def human_readable_time(context, timestamp):
    user_timezone_timestamp = timestamp.astimezone(context.get('user_time_zone', tzutc()))
    return strftime_localized(user_timezone_timestamp, 'DATE_TIME')


@contextfilter
def call_to_action_button(context, url, text):
    result = '<a href="{url}">{text}</a>'.format(url=url, text=escape(text))
    if context.eval_ctx.autoescape:
        return Markup(result)
    return result


from sailthru.sailthru_client import SailthruClient
import time


EmailTemplate = namedtuple('EmailTemplate', ['subject', 'content_template', 'preview_text'])


class SailthruEmailBatch(namedtuple('_SailthruEmailBatchBase', ['schedule_ids', 'email_template', 'sailthru_template_name'])):

    def send(self):
        email_context = build_email_context(self.schedule_ids, self.email_template)
        print(email_context)

        if not hasattr(settings, 'SAILTHRU_API_KEY') or not hasattr(settings, 'SAILTHRU_API_SECRET'):
            return

        sailthru_client = SailthruClient(settings.SAILTHRU_API_KEY, settings.SAILTHRU_API_SECRET)

        SAILTHRU_MAX_SEND_BATCH_SIZE = 100

        for batch_email_addresses in batch_iterator(email_context.keys(), SAILTHRU_MAX_SEND_BATCH_SIZE):
            self._wait_for_rate_limit(sailthru_client)

            batch_context = {k:email_context[k] for k in batch_email_addresses}
            response = sailthru_client.multi_send(
                self.sailthru_template_name,
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

    def _wait_for_rate_limit(self, sailthru_client):
        rate_limit_info = sailthru_client.get_last_rate_limit_info('send', 'POST')
        if rate_limit_info is not None:
            remaining = int(rate_limit_info['remaining'])
            reset_timestamp = int(rate_limit_info['reset'])
            seconds_till_reset = reset_timestamp - time.time()
            if remaining <= 0 and seconds_till_reset > 0:
                print('Rate limit exceeded, sleeping for {0} seconds'.format(seconds_till_reset))
                time.sleep(seconds_till_reset + 1)
