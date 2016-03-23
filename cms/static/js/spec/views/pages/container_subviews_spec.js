define(["jquery", "underscore", "underscore.string", "common/js/spec_helpers/ajax_helpers",
        "common/js/spec_helpers/template_helpers", "js/spec_helpers/edit_helpers",
        "common/js/components/views/feedback_prompt", "js/views/pages/container",
        "js/views/pages/container_subviews", "js/models/xblock_info", "js/views/utils/xblock_utils"],
    function ($, _, str, AjaxHelpers, TemplateHelpers, EditHelpers, Prompt, ContainerPage, ContainerSubviews,
              XBlockInfo, XBlockUtils) {
        var VisibilityState = XBlockUtils.VisibilityState;

        describe("Container Subviews", function() {
            var model, containerPage, requests, createContainerPage, renderContainerPage,
                respondWithHtml, fetch,
                disabledCss = "is-disabled", defaultXBlockInfo, createXBlockInfo,
                mockContainerPage = readFixtures('mock/mock-container-page.underscore'),
                mockContainerXBlockHtml = readFixtures('mock/mock-empty-container-xblock.underscore');

            beforeEach(function () {
                TemplateHelpers.installTemplate('publish-xblock');
                TemplateHelpers.installTemplate('publish-history');
                TemplateHelpers.installTemplate('unit-outline');
                appendSetFixtures(mockContainerPage);
            });

            defaultXBlockInfo = {
                id: 'locator-container',
                display_name: 'Test Container',
                category: 'vertical',
                published: false,
                has_changes: false,
                visibility_state: VisibilityState.unscheduled,
                edited_on: "Jul 02, 2014 at 14:20 UTC", edited_by: "joe",
                published_on: "Jul 01, 2014 at 12:45 UTC", published_by: "amako",
                currently_visible_to_students: false
            };

            createXBlockInfo = function(options) {
                return _.extend(_.extend({}, defaultXBlockInfo), options || {});
            };

            createContainerPage = function (test, options) {
                requests = AjaxHelpers.requests(test);
                model = new XBlockInfo(createXBlockInfo(options), { parse: true });
                containerPage = new ContainerPage({
                    model: model,
                    templates: EditHelpers.mockComponentTemplates,
                    el: $('#content'),
                    isUnitPage: true
                });
            };

            renderContainerPage = function (test, html, options) {
                createContainerPage(test, options);
                containerPage.render();
                respondWithHtml(html, options);
            };

            respondWithHtml = function(html, options) {
                AjaxHelpers.respondWithJson(
                    requests,
                    { html: html, "resources": [] }
                );
                AjaxHelpers.expectJsonRequest(requests, 'GET', '/xblock/locator-container');
                AjaxHelpers.respondWithJson(requests, createXBlockInfo(options));
            };

            fetch = function (json) {
                json = createXBlockInfo(json);
                model.fetch();
                AjaxHelpers.expectJsonRequest(requests, 'GET', '/xblock/locator-container');
                AjaxHelpers.respondWithJson(requests, json);
            };

            describe("ViewLiveButtonController", function () {
                var viewPublishedCss = '.button-view',
                    visibilityNoteCss = '.note-visibility';

                it('renders correctly for unscheduled unit', function () {
                    renderContainerPage(this, mockContainerXBlockHtml);
                    expect(containerPage.$(viewPublishedCss)).toHaveClass(disabledCss);
                    expect(containerPage.$(viewPublishedCss).attr('title')).toBe("Open the courseware in the LMS");
                    expect(containerPage.$('.button-preview')).not.toHaveClass(disabledCss);
                    expect(containerPage.$('.button-preview').attr('title')).toBe("Preview the courseware in the LMS");
                });

                it('updates when publish state changes', function () {
                    renderContainerPage(this, mockContainerXBlockHtml);
                    fetch({published: true});
                    expect(containerPage.$(viewPublishedCss)).not.toHaveClass(disabledCss);

                    fetch({published: false});
                    expect(containerPage.$(viewPublishedCss)).toHaveClass(disabledCss);
                });

                it('updates when has_content_group_components attribute changes', function () {
                    renderContainerPage(this, mockContainerXBlockHtml);
                    fetch({has_content_group_components: false});
                    expect(containerPage.$(visibilityNoteCss).length).toBe(0);

                    fetch({has_content_group_components: true});
                    expect(containerPage.$(visibilityNoteCss).length).toBe(1);

                    fetch({has_content_group_components: false});
                    expect(containerPage.$(visibilityNoteCss).length).toBe(0);
                });
            });

            describe("Publisher", function () {
                var headerCss = '.pub-status',
                    bitPublishingCss = "div.bit-publishing",
                    liveClass = "is-live",
                    readyClass = "is-ready",
                    staffOnlyClass = "is-staff-only",
                    scheduledClass = "is-scheduled",
                    unscheduledClass = "",
                    hasWarningsClass = 'has-warnings',
                    publishButtonCss = ".action-publish",
                    discardChangesButtonCss = ".action-discard",
                    lastDraftCss = ".wrapper-last-draft",
                    releaseDateTitleCss = ".wrapper-release .title",
                    releaseDateContentCss = ".wrapper-release .copy",
                    releaseDateDateCss = ".wrapper-release .copy .release-date",
                    releaseDateWithCss = ".wrapper-release .copy .release-with",
                    promptSpies, sendDiscardChangesToServer, verifyPublishingBitUnscheduled;

                sendDiscardChangesToServer = function() {
                    // Helper function to do the discard operation, up until the server response.
                    containerPage.render();
                    respondWithHtml(mockContainerXBlockHtml);
                    fetch({published: true, has_changes: true, visibility_state: VisibilityState.needsAttention});
                    expect(containerPage.$(discardChangesButtonCss)).not.toHaveClass('is-disabled');
                    expect(containerPage.$(bitPublishingCss)).toHaveClass(hasWarningsClass);
                    // Click discard changes
                    containerPage.$(discardChangesButtonCss).click();

                    // Confirm the discard.
                    expect(promptSpies.constructor).toHaveBeenCalled();
                    promptSpies.constructor.mostRecentCall.args[0].actions.primary.click(promptSpies);

                    AjaxHelpers.expectJsonRequest(requests, "POST", "/xblock/locator-container",
                        {"publish": "discard_changes"}
                    );
                };

                verifyPublishingBitUnscheduled = function() {
                    expect(containerPage.$(bitPublishingCss)).not.toHaveClass(liveClass);
                    expect(containerPage.$(bitPublishingCss)).not.toHaveClass(readyClass);
                    expect(containerPage.$(bitPublishingCss)).not.toHaveClass(hasWarningsClass);
                    expect(containerPage.$(bitPublishingCss)).not.toHaveClass(staffOnlyClass);
                    expect(containerPage.$(bitPublishingCss)).not.toHaveClass(scheduledClass);
                    expect(containerPage.$(bitPublishingCss)).toHaveClass(unscheduledClass);
                };

                beforeEach(function() {
                    promptSpies = spyOnConstructor(Prompt, "Warning", ["show", "hide"]);
                    promptSpies.show.andReturn(this.promptSpies);
                });

                it('renders correctly with private content', function () {
                    var verifyPrivateState = function() {
                        expect(containerPage.$(headerCss).text()).toContain('Draft (Never published)');
                        expect(containerPage.$(publishButtonCss)).not.toHaveClass(disabledCss);
                        expect(containerPage.$(discardChangesButtonCss)).toHaveClass(disabledCss);
                        expect(containerPage.$(bitPublishingCss)).not.toHaveClass(readyClass);
                        expect(containerPage.$(bitPublishingCss)).not.toHaveClass(scheduledClass);
                        expect(containerPage.$(bitPublishingCss)).toHaveClass(hasWarningsClass);
                    };
                    renderContainerPage(this, mockContainerXBlockHtml);
                    fetch({published: false, has_changes: false, visibility_state: VisibilityState.needsAttention});
                    verifyPrivateState();

                    fetch({published: false, has_changes: true, visibility_state: VisibilityState.needsAttention});
                    verifyPrivateState();
                });

                it('renders correctly with published content', function () {
                    renderContainerPage(this, mockContainerXBlockHtml);
                    fetch({
                        published: true, has_changes: false, visibility_state: VisibilityState.ready,
                        release_date: "Jul 02, 2030 at 14:20 UTC"
                    });
                    expect(containerPage.$(headerCss).text()).toContain('Published (not yet released)');
                    expect(containerPage.$(publishButtonCss)).toHaveClass(disabledCss);
                    expect(containerPage.$(discardChangesButtonCss)).toHaveClass(disabledCss);
                    expect(containerPage.$(bitPublishingCss)).toHaveClass(readyClass);
                    expect(containerPage.$(bitPublishingCss)).toHaveClass(scheduledClass);

                    fetch({
                        published: true, has_changes: true, visibility_state: VisibilityState.needsAttention,
                        release_date: "Jul 02, 2030 at 14:20 UTC"
                    });
                    expect(containerPage.$(headerCss).text()).toContain('Draft (Unpublished changes)');
                    expect(containerPage.$(publishButtonCss)).not.toHaveClass(disabledCss);
                    expect(containerPage.$(discardChangesButtonCss)).not.toHaveClass(disabledCss);
                    expect(containerPage.$(bitPublishingCss)).toHaveClass(hasWarningsClass);
                    expect(containerPage.$(bitPublishingCss)).toHaveClass(scheduledClass);

                    fetch({published: true, has_changes: false, visibility_state: VisibilityState.live,
                        release_date: "Jul 02, 1990 at 14:20 UTC"
                    });
                    expect(containerPage.$(headerCss).text()).toContain('Published and Live');
                    expect(containerPage.$(publishButtonCss)).toHaveClass(disabledCss);
                    expect(containerPage.$(discardChangesButtonCss)).toHaveClass(disabledCss);
                    expect(containerPage.$(bitPublishingCss)).toHaveClass(liveClass);
                    expect(containerPage.$(bitPublishingCss)).toHaveClass(scheduledClass);

                    fetch({published: true, has_changes: false, visibility_state: VisibilityState.unscheduled,
                        release_date: null
                    });
                    expect(containerPage.$(headerCss).text()).toContain('Published (not yet released)');
                    expect(containerPage.$(publishButtonCss)).toHaveClass(disabledCss);
                    expect(containerPage.$(discardChangesButtonCss)).toHaveClass(disabledCss);
                    verifyPublishingBitUnscheduled();
                });

                it('can publish private content', function () {
                    var notificationSpy = EditHelpers.createNotificationSpy();
                    renderContainerPage(this, mockContainerXBlockHtml);
                    expect(containerPage.$(bitPublishingCss)).not.toHaveClass(hasWarningsClass);
                    expect(containerPage.$(bitPublishingCss)).not.toHaveClass(readyClass);
                    expect(containerPage.$(bitPublishingCss)).not.toHaveClass(liveClass);

                    // Click publish
                    containerPage.$(publishButtonCss).click();
                    EditHelpers.verifyNotificationShowing(notificationSpy, /Publishing/);

                    AjaxHelpers.expectJsonRequest(requests, "POST", "/xblock/locator-container",
                        {"publish": "make_public"}
                    );

                    // Response to publish call
                    AjaxHelpers.respondWithJson(requests, {"id": "locator-container", "data": null, "metadata":{}});
                    EditHelpers.verifyNotificationHidden(notificationSpy);

                    AjaxHelpers.expectJsonRequest(requests, "GET", "/xblock/locator-container");
                    // Response to fetch
                    AjaxHelpers.respondWithJson(
                        requests,
                        createXBlockInfo({
                            published: true, has_changes: false, visibility_state: VisibilityState.ready
                        })
                    );

                    // Verify updates displayed
                    expect(containerPage.$(bitPublishingCss)).toHaveClass(readyClass);
                    // Verify that the "published" value has been cleared out of the model.
                    expect(containerPage.model.get("publish")).toBeNull();
                });

                it('does not refresh if publish fails', function () {
                    renderContainerPage(this, mockContainerXBlockHtml);
                    verifyPublishingBitUnscheduled();

                    // Click publish
                    containerPage.$(publishButtonCss).click();

                    // Respond with failure
                    AjaxHelpers.respondWithError(requests);
                    AjaxHelpers.expectNoRequests(requests);

                    // Verify still in draft (unscheduled) state.
                    verifyPublishingBitUnscheduled();
                    // Verify that the "published" value has been cleared out of the model.
                    expect(containerPage.model.get("publish")).toBeNull();
                });

                it('can discard changes', function () {
                    var notificationSpy, renderPageSpy, numRequests;
                    createContainerPage(this);
                    notificationSpy = EditHelpers.createNotificationSpy();
                    renderPageSpy = spyOn(containerPage.xblockPublisher, 'renderPage').andCallThrough();

                    sendDiscardChangesToServer();
                    numRequests = requests.length;

                    // Respond with success.
                    AjaxHelpers.respondWithJson(requests, {"id": "locator-container"});
                    EditHelpers.verifyNotificationHidden(notificationSpy);

                    // Verify other requests are sent to the server to update page state.
                    // Response to fetch, specifying the very next request (as multiple requests will be sent to server)
                    expect(requests.length > numRequests).toBeTruthy();
                    expect(containerPage.model.get("publish")).toBeNull();
                    expect(renderPageSpy).toHaveBeenCalled();
                });

                it('does not fetch if discard changes fails', function () {
                    var renderPageSpy, numRequests;
                    createContainerPage(this);
                    renderPageSpy = spyOn(containerPage.xblockPublisher, 'renderPage').andCallThrough();

                    sendDiscardChangesToServer();

                    // Respond with failure
                    AjaxHelpers.respondWithError(requests);
                    AjaxHelpers.expectNoRequests(requests);
                    expect(containerPage.$(discardChangesButtonCss)).not.toHaveClass('is-disabled');
                    expect(containerPage.model.get("publish")).toBeNull();
                    expect(renderPageSpy).not.toHaveBeenCalled();
                });

                it('does not discard changes on cancel', function () {
                    renderContainerPage(this, mockContainerXBlockHtml);
                    fetch({published: true, has_changes: true, visibility_state: VisibilityState.needsAttention});

                    // Click discard changes
                    expect(containerPage.$(discardChangesButtonCss)).not.toHaveClass('is-disabled');
                    containerPage.$(discardChangesButtonCss).click();

                    // Click cancel to confirmation.
                    expect(promptSpies.constructor).toHaveBeenCalled();
                    promptSpies.constructor.mostRecentCall.args[0].actions.secondary.click(promptSpies);
                    AjaxHelpers.expectNoRequests(requests);
                    expect(containerPage.$(discardChangesButtonCss)).not.toHaveClass('is-disabled');
                });

                it('renders the last published date and user when there are no changes', function () {
                    renderContainerPage(this, mockContainerXBlockHtml);
                    fetch({published_on: "Jul 01, 2014 at 12:45 UTC", published_by: "amako"});
                    expect(containerPage.$(lastDraftCss).text()).
                        toContain("Last published Jul 01, 2014 at 12:45 UTC by amako");
                });

                it('renders the last saved date and user when there are changes', function () {
                    renderContainerPage(this, mockContainerXBlockHtml);
                    fetch({has_changes: true, edited_on: "Jul 02, 2014 at 14:20 UTC", edited_by: "joe"});
                    expect(containerPage.$(lastDraftCss).text()).
                        toContain("Draft saved on Jul 02, 2014 at 14:20 UTC by joe");
                });

                describe("Release Date", function() {
                    it('renders correctly when unreleased', function () {
                        renderContainerPage(this, mockContainerXBlockHtml);
                        fetch({
                            visibility_state: VisibilityState.ready, released_to_students: false,
                            release_date: "Jul 02, 2014 at 14:20 UTC", release_date_from: 'Section "Week 1"'
                        });
                        expect(containerPage.$(releaseDateTitleCss).text()).toContain("Scheduled:");
                        expect(containerPage.$(releaseDateDateCss).text()).toContain('Jul 02, 2014 at 14:20 UTC');
                        expect(containerPage.$(releaseDateWithCss).text()).toContain('with Section "Week 1"');
                    });

                    it('renders correctly when released', function () {
                        renderContainerPage(this, mockContainerXBlockHtml);
                        fetch({
                            visibility_state: VisibilityState.live, released_to_students: true,
                            release_date: "Jul 02, 2014 at 14:20 UTC", release_date_from: 'Section "Week 1"'
                        });
                        expect(containerPage.$(releaseDateTitleCss).text()).toContain("Released:");
                        expect(containerPage.$(releaseDateDateCss).text()).toContain('Jul 02, 2014 at 14:20 UTC');
                        expect(containerPage.$(releaseDateWithCss).text()).toContain('with Section "Week 1"');
                    });

                    it('renders correctly when the release date is not set', function () {
                        renderContainerPage(this, mockContainerXBlockHtml);
                        fetch({
                            visibility_state: VisibilityState.unscheduled, "released_to_students": false,
                            release_date: null, release_date_from: null
                        });
                        expect(containerPage.$(releaseDateTitleCss).text()).toContain("Release:");
                        expect(containerPage.$(releaseDateContentCss).text()).toContain("Unscheduled");
                    });

                    it('renders correctly when the unit is not published', function () {
                        renderContainerPage(this, mockContainerXBlockHtml);
                        fetch({
                            visibility_state: VisibilityState.needsAttention, released_to_students: true,
                            release_date: "Jul 02, 2014 at 14:20 UTC", release_date_from: 'Section "Week 1"'
                        });
                        containerPage.xblockPublisher.render();
                        expect(containerPage.$(releaseDateTitleCss).text()).toContain("Release:");
                        expect(containerPage.$(releaseDateDateCss).text()).toContain('Jul 02, 2014 at 14:20 UTC');
                        expect(containerPage.$(releaseDateWithCss).text()).toContain('with Section "Week 1"');
                    });
                });

                describe("Content Visibility", function () {
                    var requestStaffOnly, verifyStaffOnly, verifyExplicitStaffOnly, verifyImplicitStaffOnly, promptSpy,
                        visibilityTitleCss = '.wrapper-visibility .title';

                    requestStaffOnly = function(isStaffOnly) {
                        var newVisibilityState;

                        containerPage.$('.action-staff-lock').click();

                        // If removing explicit staff lock with no implicit staff lock, click 'Yes' to confirm
                        if (!isStaffOnly && !containerPage.model.get('ancestor_has_staff_lock')) {
                            EditHelpers.confirmPrompt(promptSpy);
                        }

                        AjaxHelpers.expectJsonRequest(requests, 'POST', '/xblock/locator-container', {
                            publish: 'republish',
                            metadata: { visible_to_staff_only: isStaffOnly ? true : null }
                        });
                        AjaxHelpers.respondWithJson(requests, {
                            data: null,
                            id: "locator-container",
                            metadata: {
                                visible_to_staff_only: isStaffOnly ? true : null
                            }
                        });

                        AjaxHelpers.expectJsonRequest(requests, 'GET', '/xblock/locator-container');
                        if (isStaffOnly || containerPage.model.get('ancestor_has_staff_lock')) {
                            newVisibilityState = VisibilityState.staffOnly;
                        } else {
                            newVisibilityState = VisibilityState.live;
                        }
                        AjaxHelpers.respondWithJson(requests, createXBlockInfo({
                            published: containerPage.model.get('published'),
                            has_explicit_staff_lock: isStaffOnly,
                            visibility_state: newVisibilityState,
                            release_date: "Jul 02, 2000 at 14:20 UTC"
                        }));
                    };

                    verifyStaffOnly = function(isStaffOnly) {
                        var visibilityCopy = containerPage.$('.wrapper-visibility .copy').text().trim();
                        if (isStaffOnly) {
                            expect(visibilityCopy).toContain('Staff Only');
                            expect(containerPage.$(bitPublishingCss)).toHaveClass(staffOnlyClass);
                        } else {
                            expect(visibilityCopy).toBe('Staff and Students');
                            expect(containerPage.$(bitPublishingCss)).not.toHaveClass(staffOnlyClass);
                            verifyExplicitStaffOnly(false);
                            verifyImplicitStaffOnly(false);
                        }
                    };

                    verifyExplicitStaffOnly = function(isStaffOnly) {
                        if (isStaffOnly) {
                            expect(containerPage.$('.action-staff-lock i')).toHaveClass('fa-check-square-o');
                        } else {
                            expect(containerPage.$('.action-staff-lock i')).toHaveClass('fa-square-o');
                        }
                    };

                    verifyImplicitStaffOnly = function(isStaffOnly) {
                        if (isStaffOnly) {
                            expect(containerPage.$('.wrapper-visibility .inherited-from')).toExist();
                        } else {
                            expect(containerPage.$('.wrapper-visibility .inherited-from')).not.toExist();
                        }
                    };

                    it("is initially shown to all", function() {
                        renderContainerPage(this, mockContainerXBlockHtml);
                        verifyStaffOnly(false);
                    });

                    it("displays 'Is Visible To' when released and published", function() {
                        renderContainerPage(this, mockContainerXBlockHtml, {
                            released_to_students: true,
                            published: true,
                            has_changes: false
                        });
                        expect(containerPage.$(visibilityTitleCss).text()).toContain('Is Visible To');
                    });

                    it("displays 'Will Be Visible To' when not released or fully published", function() {
                        renderContainerPage(this, mockContainerXBlockHtml, {
                            released_to_students: false,
                            published: true,
                            has_changes: true
                        });
                        expect(containerPage.$(visibilityTitleCss).text()).toContain('Will Be Visible To');
                    });

                    it("can be explicitly set to staff only", function() {
                        renderContainerPage(this, mockContainerXBlockHtml);
                        requestStaffOnly(true);
                        verifyExplicitStaffOnly(true);
                        verifyImplicitStaffOnly(false);
                        verifyStaffOnly(true);
                    });

                    it("can be implicitly set to staff only", function() {
                        renderContainerPage(this, mockContainerXBlockHtml, {
                            visibility_state: VisibilityState.staffOnly,
                            ancestor_has_staff_lock: true,
                            staff_lock_from: "Section Foo"
                        });
                        verifyImplicitStaffOnly(true);
                        verifyExplicitStaffOnly(false);
                        verifyStaffOnly(true);
                    });

                    it("can be explicitly and implicitly set to staff only", function() {
                        renderContainerPage(this, mockContainerXBlockHtml, {
                            visibility_state: VisibilityState.staffOnly,
                            ancestor_has_staff_lock: true,
                            staff_lock_from: "Section Foo"
                        });
                        requestStaffOnly(true);
                        // explicit staff lock overrides the display of implicit staff lock
                        verifyImplicitStaffOnly(false);
                        verifyExplicitStaffOnly(true);
                        verifyStaffOnly(true);
                    });

                    it("can remove explicit staff only setting without having implicit staff only", function() {
                        promptSpy = EditHelpers.createPromptSpy();
                        renderContainerPage(this, mockContainerXBlockHtml, {
                            visibility_state: VisibilityState.staffOnly,
                            has_explicit_staff_lock: true,
                            ancestor_has_staff_lock: false
                        });
                        requestStaffOnly(false);
                        verifyStaffOnly(false);
                    });

                    it("can remove explicit staff only setting while having implicit staff only", function() {
                        promptSpy = EditHelpers.createPromptSpy();
                        renderContainerPage(this, mockContainerXBlockHtml, {
                            visibility_state: VisibilityState.staffOnly,
                            ancestor_has_staff_lock: true,
                            has_explicit_staff_lock: true,
                            staff_lock_from: "Section Foo"
                        });
                        requestStaffOnly(false);
                        verifyExplicitStaffOnly(false);
                        verifyImplicitStaffOnly(true);
                        verifyStaffOnly(true);
                    });

                    it("does not refresh if removing staff only is canceled", function() {
                        promptSpy = EditHelpers.createPromptSpy();
                        renderContainerPage(this, mockContainerXBlockHtml, {
                            visibility_state: VisibilityState.staffOnly,
                            has_explicit_staff_lock: true,
                            ancestor_has_staff_lock: false
                        });
                        containerPage.$('.action-staff-lock').click();
                        EditHelpers.confirmPrompt(promptSpy, true);    // Click 'No' to cancel
                        AjaxHelpers.expectNoRequests(requests);
                        verifyExplicitStaffOnly(true);
                        verifyStaffOnly(true);
                    });

                    it("does not refresh when failing to set staff only", function() {
                        renderContainerPage(this, mockContainerXBlockHtml);
                        containerPage.$('.action-staff-lock').click();
                        AjaxHelpers.respondWithError(requests);
                        AjaxHelpers.expectNoRequests(requests);
                        verifyStaffOnly(false);
                    });
                });
            });

            describe("PublishHistory", function () {
                var lastPublishCss = ".wrapper-last-publish";

                it('renders never published when the block is unpublished', function () {
                    renderContainerPage(this, mockContainerXBlockHtml, {
                        published: false, published_on: null, published_by: null
                    });
                    expect(containerPage.$(lastPublishCss).text()).toContain("Never published");
                });

                it('renders the last published date and user when the block is published', function() {
                    renderContainerPage(this, mockContainerXBlockHtml);
                    fetch({
                        published: true, published_on: "Jul 01, 2014 at 12:45 UTC", published_by: "amako"
                    });
                    expect(containerPage.$(lastPublishCss).text()).
                        toContain("Last published Jul 01, 2014 at 12:45 UTC by amako");
                });

                it('renders correctly when the block is published without publish info', function () {
                    renderContainerPage(this, mockContainerXBlockHtml);
                    fetch({
                        published: true, published_on: null, published_by: null
                    });
                    expect(containerPage.$(lastPublishCss).text()).toContain("Previously published");
                });
            });

            describe("Message Area", function() {
                var messageSelector = '.container-message .warning',
                    warningMessage = 'Caution: The last published version of this unit is live. ' +
                        'By publishing changes you will change the student experience.';

                it('is empty for a unit that is not currently visible to students', function() {
                    renderContainerPage(this, mockContainerXBlockHtml, {
                        currently_visible_to_students: false
                    });
                    expect(containerPage.$(messageSelector).text().trim()).toBe('');
                });

                it('shows a message for a unit that is currently visible to students', function() {
                    renderContainerPage(this, mockContainerXBlockHtml, {
                        currently_visible_to_students: true
                    });
                    expect(containerPage.$(messageSelector).text().trim()).toBe(warningMessage);
                });

                it('hides the message when the unit is hidden from students', function() {
                    renderContainerPage(this, mockContainerXBlockHtml, {
                        currently_visible_to_students: true
                    });
                    fetch({ currently_visible_to_students: false });
                    expect(containerPage.$(messageSelector).text().trim()).toBe('');
                });

                it('shows a message when a unit is made visible', function() {
                    renderContainerPage(this, mockContainerXBlockHtml, {
                        currently_visible_to_students: false
                    });
                    fetch({ currently_visible_to_students: true });
                    expect(containerPage.$(messageSelector).text().trim()).toBe(warningMessage);
                });
            });
        });
    });
