> 本文由 [简悦 SimpRead](http://ksria.com/simpread/) 转码， 原文地址 [developer.chrome.com](https://developer.chrome.com/blog/bookmarks-sync-changes)

> Learn about upcoming changes to bookmarks sync that impact extensions.

*   [Chrome for Developers](https://developer.chrome.com/)
*   [Blog](https://developer.chrome.com/blog)

Was this helpful?

Update your extensions ahead of upcoming bookmark sync changes bookmark_borderbookmark Stay organized with collections Save and categorize content based on your preferences.
=============================================================================================================================================================================

*   On this page
*   [Overview](#overview)
*   [Detailed API changes](#detailed_api_changes)
*   [Extension updates](#extension_updates)
*   [Testing](#testing)
*   [Timelines](#timelines)

.wd-authors { --avatar-size: 65px; display: flex; gap: 2em; } .wd-author { display: flex; flex-wrap: wrap; gap: 1em; line-height: calc(var(--avatar-size) / 2); } .wd-author img { border-radius: 50%; height: var(--avatar-size, 65px); width: var(--avatar-size, 65px); } .dcc-authors { --avatar-size: 65px; display: flex; gap: 2em; } .dcc-author { display: flex; flex-wrap: wrap; gap: 1em; line-height: calc(var(--avatar-size) / 2); } .dcc-author img { border-radius: 50%; height: var(--avatar-size, 65px); width: var(--avatar-size, 65px); } .dcc-author__links { display: flex; } .dcc-author__links a { margin-inline-end: 6px; } .dcc-author__links a:last-of-type { margin-inline-end: 0; }

![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAACbklEQVRoQ+2aMU4dMRCGZw6RC1CSSyQdLZJtKQ2REgoiRIpQkCYClCYpkgIESQFIpIlkW+IIcIC0gUNwiEFGz+hlmbG9b1nesvGW++zxfP7H4/H6IYzkwZFwQAUZmpJVkSeniFJKA8ASIi7MyfkrRPxjrT1JjZ8MLaXUDiJuzwngn2GJaNd7vyP5IoIYY94Q0fEQIKIPRGS8947zSQTRWh8CwLuBgZx479+2BTkHgBdDAgGAC+fcywoyIFWqInWN9BSONbTmFVp/AeA5o+rjKRJ2XwBYRsRXM4ZXgAg2LAPzOCDTJYQx5pSIVlrC3EI45y611osMTHuQUPUiYpiVooerg7TWRwDAlhSM0TuI+BsD0x4kGCuFSRVzSqkfiLiWmY17EALMbCAlMCmI6IwxZo+INgQYEYKBuW5da00PKikjhNNiiPGm01rrbwDwofGehQjjNcv1SZgddALhlJEgwgJFxDNr7acmjFLqCyJuTd6LEGFttpmkYC91Hrk3s1GZFERMmUT01Xv/sQljjPlMRMsxO6WULwnb2D8FEs4j680wScjO5f3vzrlNJszESWq2LYXJgTzjZm56MCHf3zVBxH1r7ftU1splxxKYHEgoUUpTo+grEf303rPH5hxENJqDKQEJtko2q9zGeeycWy3JhpKhWT8+NM/sufIhBwKI+Mta+7pkfxKMtd8Qtdbcx4dUQZcFCQ2I6DcAnLUpf6YMPxhIDDOuxC4C6djoQUE6+tKpewWZ1wlRkq0qUhXptKTlzv93aI3jWmE0Fz2TeujpX73F9TaKy9CeMk8vZusfBnqZ1g5GqyIdJq+XrqNR5AahKr9CCcxGSwAAAABJRU5ErkJggg==) James Lee

Published: June 17, 2025

Last August, we announced [upcoming changes to the Chrome identity model](https://blog.chromium.org/2024/08/seamlessly-use-your-passwords-and.html) on Windows, Mac, and Linux platforms, following those which have already been launched on iOS and Android. The goal of these changes is to align Chrome with current user expectations regarding signing in. Users increasingly expect to just sign in to get access to their stuff, including bookmarks, and sign out to keep it safe.

As part of rolling out these updates, we're introducing changes to how Chrome stores bookmarks on desktop. Bookmarks, for example, that are stored locally on a device will remain local upon sign-in; users can optionally choose to upload such data to their Google Account individually or in bulk. To allow extensions to support these, we are exposing new data on the [Chrome Extensions API](/docs/extensions/reference/api/bookmarks). The following information is relevant to any authors of Chrome Extensions that use the `chrome.bookmarks` API.

Overview
--------

Today, users always have a single set of top-level folders, including the "Bookmarks bar" and "Other bookmarks" folders. The data in these folders may or may not be synced depending on if the user is signed in with syncing enabled or not.

As part of the identity model changes, Chrome will separate syncing and non-syncing bookmarks into two separate subtrees in the [bookmarks tree](/docs/extensions/reference/api/bookmarks#objects_and_properties). In some cases where a user has not chosen to upload all of their bookmarks to their account, a user may have both syncing and non-syncing bookmark folders simultaneously. Extensions which use the bookmarks API may need updating, in order to display the bookmarks tree in a way that is clear to users.

Detailed API changes
--------------------

For users with a mixture of syncing and non-syncing bookmarks, the bookmarks API may return a tree similar to the following on the [getTree](/docs/extensions/reference/api/bookmarks#method-getTree) API:

*   id=A (name: "Bookmarks bar", folderType: "bookmarks-bar", syncing: true)
    *   …
*   id=B (name: "Other bookmarks", folderType: "other", syncing: true)
    *   …
*   id=C (name: "Bookmarks bar", folderType: "bookmarks-bar", syncing: false)
    *   …
*   id=D (name: "Other bookmarks", folderType: "other", syncing: false)
    *   …

To let extension developers distinguish between these top-level folders, two new properties have been added to the API:

*   `folderType`: this allows extensions to identify the "special" folders such as the bookmarks bar. Note that the `name` and `id` shouldn't be used for this purpose (`name` is locale-dependent, and `id` is not fixed)
*   `syncing`: to allow extensions to differentiate between the syncing and non-syncing parts of the tree. This will be `true` before the identity model changes if the user is signed in and has sync enabled.

**Note:** Depending on the user's identity state the bookmark tree may or may not contain each of the folder types mentioned. These could also change over time. You should use the relevant lifecycle events (onCreated, onChanged, onRemoved) to handle this.

Extension updates
-----------------

If any of the following things are true for your extension, you may need to make updates:

*   If your extension displays the full result of getTree to the user to prevent identically-named versions of, for example, the bookmarks bar from being displayed. You may want to append a suffix to the name, or provide some other UI treatment.
*   If your extension attempts to match the bookmarks-bar, other, or mobile permanent folders by `id` or `name`. These methods were already unsupported.
*   If your extension assumes that there is exactly or at most one instance of the bookmarks-bar, other, or mobile permanent folders

Testing
-------

The new `folderType` and `syncing` extension API properties are [documented](/docs/extensions/reference/api/bookmarks) and available in the latest Chrome Canary release (version 138.0.7196.0 or later).

Users in stable Chrome channels have a single storage (that is, at most one of each of the folder types). For testing purposes you can enable dual storages as follows:

1.  Enable both the following in chrome://flags, and restart Chrome
    *   sync-enable-bookmarks-in-transport-mode
    *   enable-bookmarks-selected-type-on-signin-for-testing
2.  Add a new Chrome profile (https://support.google.com/chrome/answer/2364824)
    *   Don't sign in: choose"Continue without an account".
3.  If you bookmark pages, they will be added to the non-syncing storage.
4.  Now sign in to Chrome:
    *   Click that avatar picture at the top-right, next to the three-dot menu.
    *   Click "Sign in to Chrome" and follow the prompts.
    *   Choose "No thanks" when asked if you want to turn on sync.
5.  If you bookmark pages, they will be added to the syncing storage (enabling you to test the dual-storage case).

Timelines
---------

The changes to expose dual storages will be rolled out gradually, and will start rolling out for a subset of Chrome Stable channel users **not before end-June 2025**, starting for a small percentage of users and then rolling out more widely over the following weeks.

Was this helpful?