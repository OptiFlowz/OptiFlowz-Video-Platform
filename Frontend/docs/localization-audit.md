# Localization audit — 2026-09-07

Checked all 40 supported catalogues against the 1058 English keys and scanned application TypeScript/TSX for literal translation calls, JSX text and display attributes.

## Completed in this change

- Rewrote playback protection and spoken-language help, plus their option labels, in all 40 languages (six entries per catalogue).
- Signed describes platform-authorized access and recommends retaining protection. Public explains that anyone with the player URL can view outside the platform.
- Avoided promising domain enforcement: signed playback alone requires authorization, while domain restrictions are an additional Mux setting. See [Mux secure playback](https://www.mux.com/docs/guides/secure-video-playback).
- Restored seven broken parameterized messages: six Serbian quiz/tag strings and the Arabic tag label.
- Replaced the nonexistent `noBioPerson` lookup in search with the existing `noDescription` translation.
- Connected upload Cancel, Back, Next, Save, Saving, Remove and contributor labels to existing translations.

- Follow-up: localized upload/editor form text, action labels, duration, thumbnail feedback, caption guidance, processing states and application error messages in all 40 languages. Shared thumbnail, contributor-search and caption components now use translations.
- Applied the same translations and styling to the existing-video editor. Language names use localized display names (Serbian Latin script).
- Corrected chair-role labels and contributor search placeholders; “Chairs” refers to session chairs.
- Reduced the desktop preview/form ratio to 0.8:1. Thumbnail source buttons use the shared primary button style in two equal grid columns, allowing labels to wrap within the buttons. Section headings share the accent color. Verified the Serbian editor layout in the running browser.

## Structural checks

- Missing catalogue keys: 0. Existing unused extra keys: {"pt": ["vídeosLabel", "vídeosTab"], "fr": ["vidéosTab"]}.
- Empty entries: 0.
- Duplicate JSON keys: 0.
- Remaining missing literal `t()` / `translate()` keys: 0.
- Parameter-name mismatches: 0. `rawParam` versus `param` is treated as equivalent for name coverage; their runtime semantics differ.

## Remaining untranslated catalogue text

1472 entries across 62 keys contain clear English leftovers in feature copy. The table below separates these from shared words that may legitimately match English. These remaining entries have been audited, not translated in this change.

| Locale | Clear English leftovers | Other identical entries to review |
| --- | ---: | ---: |
| ar | 62 | 1 |
| bg | 25 | 0 |
| cs | 25 | 7 |
| da | 25 | 19 |
| de | 62 | 19 |
| el | 62 | 4 |
| es | 62 | 4 |
| et | 25 | 2 |
| fa | 25 | 0 |
| fi | 25 | 2 |
| fr | 62 | 17 |
| he | 25 | 0 |
| hi | 62 | 1 |
| hr | 62 | 7 |
| hu | 25 | 4 |
| id | 25 | 6 |
| is | 25 | 0 |
| it | 62 | 9 |
| ja | 25 | 0 |
| ko | 25 | 0 |
| lt | 25 | 1 |
| lv | 25 | 1 |
| mk | 25 | 0 |
| nb | 25 | 8 |
| nl | 62 | 16 |
| pl | 62 | 8 |
| pt | 62 | 4 |
| ro | 62 | 12 |
| ru | 25 | 0 |
| sk | 25 | 7 |
| sl | 62 | 4 |
| sq | 25 | 7 |
| sr | 4 | 10 |
| sv | 25 | 7 |
| th | 25 | 0 |
| tr | 62 | 4 |
| uk | 25 | 2 |
| vi | 25 | 2 |
| zh | 25 | 0 |

### Exact keys and affected languages

Languages: ar, de, el, es, fr, hi, hr, it, nl, pl, pt, ro, sl, tr.

- `platformSettingsEmpty`: No platform-wide settings have been configured yet.
- `platformUsersEmpty`: No platform user-management data is available yet.
- `channelAnalyticsTitle`: Channel Analytics
- `channelAnalyticsDescription`: Review channel performance, engagement, and audience insights.
- `channelAnalyticsOverviewDescription`: A summary of channel performance for the selected period, including views, watch time, reactions, comments, and first-time viewers.
- `channelAnalyticsTotalViewsHelp`: Views across all channel videos
- `channelAnalyticsFirstTimeViewsHelp`: First-time viewers across the channel
- `channelAnalyticsWatchTimeHelp`: Total watch time across the channel
- `channelAnalyticsTotalLikesHelp`: Likes across all channel videos
- `channelAnalyticsTotalDislikesHelp`: Dislikes across all channel videos
- `channelAnalyticsTotalCommentsHelp`: Comments across all channel videos
- `channelAnalyticsAverageEngagement`: Average engagement per video
- `channelAnalyticsBestVideos`: Best performing videos on the channel
- `channelAnalyticsBestVideosDescription`: The most viewed videos across your channel.
- `channelAnalyticsBestVideosLoading`: Loading best performing videos...
- `channelAnalyticsBestVideosFailed`: The best performing videos could not be loaded.
- `channelAnalyticsBestVideosEmpty`: There are no channel videos to show yet.
- `channelAnalyticsViewAnalytics`: View analytics
- `channelAnalyticsGraphsDescription`: Track how channel views and watch time change during the selected period.
- `channelAnalyticsAudienceDescription`: See which devices and operating systems viewers used across the channel.
- `channelAnalyticsGeographicDescription`: See where channel viewers watched from, with country and city details.
- `videoAnalyticsEngagementLoading`: Loading engagement...
- `videoAnalyticsEngagementFailed`: Engagement could not be loaded.
- `videoAnalyticsAudienceGraphs`: Audience graphs
- `videoAnalyticsWatchTimeOverTime`: Watch time over time
- `videoAnalyticsViewsOverTime`: Views over time
- `videoAnalyticsCompletionBuckets`: Completion buckets
- `videoAnalyticsCompletionBucketsFailed`: Completion buckets could not be loaded.
- `videoAnalyticsViewers`: Viewers
- `videoAnalyticsGraphsLoading`: Loading audience graphs...
- `videoAnalyticsGraphsFailed`: The audience graphs could not be loaded.
- `videoAnalyticsGraphsEmpty`: No data is available for the selected period.
- `videoAnalyticsGraphsNoneSelected`: Select at least one graph to display.

Languages: ar, bg, cs, da, de, el, es, et, fa, fi, fr, he, hi, hr, hu, id, is, it, ja, ko, lt, lv, mk, nb, nl, pl, pt, ro, ru, sk, sl, sq, sv, th, tr, uk, vi, zh.

- `homeNav`: Home
- `searchLibraryEyebrow`: Explore the library
- `searchLibraryTitle`: Find your next insight.
- `searchLibrarySubtitle`: Discover videos, curated playlists and the people behind them.
- `searchLibraryPlaceholder`: Search videos, playlists or contributors…
- `searchContentType`: Content type
- `searchVideosHint`: Watch & learn
- `searchPlaylistsHint`: Curated collections
- `searchPeopleHint`: Speakers & chairs
- `searchExploreTitle`: More to discover
- `searchExploreText`: Explore the library for your next session, topic or perspective.
- `searchExploreAction`: Explore the library
- `searchMatchingResults`: Explore matching content
- `searchSortBy`: Sort by
- `searchSortRelevance`: Most relevant
- `searchSortNewest`: Newest first
- `searchSortViews`: Most viewed
- `searchLoadingResults`: Loading search results
- `searchLoadFailed`: Results could not be loaded
- `searchTryAgain`: Please try again in a moment.
- `searchChangeQuery`: Try another search
- `searchWatchVideo`: Watch video
- `searchViewPlaylist`: View playlist
- `searchViewVideos`: View videos
- `searchResultCount`: {{param.count}} results

Languages: ar, de, el, es, fr, hi, hr, it, nl, pl, pt, ro, sl, sr, tr.

- `inThisVideo`: In this video
- `transcript`: Transcript
- `loadingTranscript`: Loading transcript...
- `transcriptUnavailable`: No transcript is available for this video.

### Shared words and remaining review candidates

Exact equality does not prove a missing translation. For example, French “Public”, German “Name”, international “Video”, “Quiz”, and role names can be correct. The branding-only `footerCopyright` is intentionally identical and excluded. The candidates below still require context-sensitive language review.

- `adminNo` — es, it
- `adminPublic` — ro
- `adminTableActions` — fr
- `adminTableDate` — fr
- `adminTablePlaylist` — it
- `adminTableQuestions` — fr
- `adminTableQuiz` — da, de, fr, it, nb, nl, pl
- `adminTableStatus` — da, de, hr, id, nb, nl, sr, sv
- `adminTableVideo` — cs, da, de, et, fi, hr, id, it, lv, nb, nl, ro, sk, sl, sq, sr, sv, vi
- `adminTableVideos` — de
- `analyticsCustom` — uk
- `analyticsDownloadPdf` — da
- `analyticsTo` — hu
- `analyticsWeek` — nl
- `certificateDownload` — da
- `errorSorry` — nl
- `featured` — sr
- `footerSupport` — da, sv
- `likeVideo` — ro
- `menuAria` — cs, da, pl, sk
- `navAnalytics` — el, ro
- `navPlatform` — da, hu, nl, tr
- `navTrending` — ro
- `navUploadVideo` — da
- `optionalField` — de
- `platformAnalyticsVideoReactionsHelp` — de
- `platformLabel` — da, hu, nl, tr
- `playbackPublic` — fr, ro
- `playlistLabel` — it
- `quizCorrect` — fr
- `quizDefaultTitle` — da, de, fr, it, nb, nl, pl
- `quizIncorrect` — fr
- `quizMatching` — sr
- `quizMatchingPairs` — sr
- `quizMinute` — fr
- `quizMinutes` — fr
- `quizMinutesShort` — cs, da, de, es, et, fi, hr, it, lt, nb, nl, pl, pt, ro, sk, sl, sq, sr, sv
- `quizOptionNumber` — de
- `quizOptional` — de
- `quizPercentage` — nl
- `quizPoints` — fr
- `quizQuestions` — fr
- `quizQuestionsButton` — fr
- `quizScoringStrict` — ro
- `quizSourcesButton` — fr
- `rolesCustom` — uk
- `rolesPermissions` — fr
- `rolesSystem` — da, de, nb, sv
- `settingsBranding` — cs, sk, sq
- `support` — da, sv
- `systemRoleAdministrator` — da, de, hr, id, nb, pl, ro, sq, sr
- `systemRoleModerator` — da, de, hr, id, nb, nl, pl, ro, sl, sq, sr, sv
- `systemRoleUploader` — nl
- `tagResultsFor` — nl
- `thread` — de
- `uploadVideoAction` — da
- `usersActions` — fr
- `usersEmail` — cs, el, pt, sk, sq, vi
- `usersName` — de
- `usersRoles` — es
- `videoAnalyticsDesktop` — cs, de, id, nl, ro, sk, sq
- `videoAnalyticsEngagement` — ar, da, de, el, es, fr, hi, hr, it, nl, pl, pt, ro, sl, tr
- `videoAnalyticsTablet` — cs, da, de, el, hr, hu, id, it, nl, pl, pt, sk, sr, tr
- `videoCategories` — sr
- `videosTab` — de

## Plural-form coverage

102 localized entries use one string where English defines plural variants. They interpolate counts but do not choose locale-specific grammatical forms. This is a separate existing quality gap, not a missing key or broken placeholder.

- `adminDeletePlaylistsTitle` — ar, bg, cs, de, el, fr, hi, hr, hu, it, mk, nl, pl, pt, ro, ru, sk, sl, sq, tr, uk
- `adminDeleteVideosTitle` — ar, bg, cs, de, el, fr, hi, hr, hu, it, mk, nl, pl, pt, ro, ru, sk, sl, sq, sr, tr, uk
- `appearsOnVideos` — ar, bg, cs, de, el, es, fr, hi, hr, hu, it, mk, nl, pl, pt, ro, ru, sk, sl, sq, sr, tr, uk
- `quizDeleteManyTitle` — ar, bg, cs, de, el, fr, hi, hr, hu, it, mk, nl, pl, pt, ro, ru, sk, sl, sq, tr, uk
- `replyCountLabel` — ar, de, el, es, fr, hi, hr, it, nl, pl, pt, ro, sl, sr, tr

## Literal UI text outside the catalogues

The source scan found 282 literal text/attribute candidates in 30 files after the fixes. This is a review list, not a count of confirmed translation defects: it includes units, names, examples, English language names and other intentional literals. JavaScript string expressions, runtime/API messages, computed translation keys and text rendered by third-party components are not exhaustively covered.

Upload and edit-video JSX text and display attributes now use translations, except the language-independent MB unit. Remaining candidates below belong to other pages. Third-party player control labels and theme tooltips are outside this editor-copy audit.

| File | Candidates |
| --- | ---: |
| `app/components/privacyPolicyPage/privacyPolicyPage.tsx` | 95 |
| `app/components/termsOfUsePage/termsOfUsePage.tsx` | 91 |
| `app/components/editPlaylistPage/editPlaylistPage.tsx` | 18 |
| `app/components/myVideosPage/videoRow/videoRow.tsx` | 8 |
| `app/components/myVideosPage/sidebar/sidebar.tsx` | 6 |
| `app/components/playPage/playerCollection/videoInfo.tsx` | 6 |
| `app/components/uemsPage/uemsPage.tsx` | 6 |
| `app/components/channelPage/channelPage.tsx` | 4 |
| `app/components/persistentVideo/persistentVideoProvider.tsx` | 4 |
| `app/components/footer/footer.tsx` | 3 |
| `app/components/homePage/slider/slider.tsx` | 3 |
| `app/components/loginPage/loginPage.tsx` | 3 |
| `app/components/myPlaylists/playlistRow/playlistRow.tsx` | 3 |
| `app/components/platformPage/sidebar/platformSidebar.tsx` | 3 |
| `app/components/playPage/playerCollection/playCard.tsx` | 3 |
| `app/components/playPage/playerCollection/playingPlaylist.tsx` | 3 |
| `app/components/playlistPage/playlistPage.tsx` | 3 |
| `app/opengraph-image.tsx` | 3 |
| `app/components/forgotPasswordPage/forgotPasswordPage.tsx` | 2 |
| `app/components/itemSlider/item.tsx` | 2 |
| `app/components/itemSlider/playlistItem.tsx` | 2 |
| `app/components/registerPage/registerPage.tsx` | 2 |
| `app/components/searchPage/verticalSlider/item.tsx` | 2 |
| `app/components/accountPage/accountInfo.tsx` | 1 |
| `app/components/accountPage/editAccountPopup.tsx` | 1 |
| `app/components/header/header.tsx` | 1 |
| `app/components/homePage/homePage.tsx` | 1 |
| `app/components/playPage/commentCollection/commentComposer.tsx` | 1 |
| `app/components/playPage/playerCollection/chairPopup.tsx` | 1 |
| `app/components/uploadPage/uploadPage.tsx` | 1 |

<details>
<summary>Literal text candidates with source locations</summary>

- `app/components/accountPage/accountInfo.tsx:66` (attribute): Profile
- `app/components/accountPage/editAccountPopup.tsx:259` (attribute): Profile pic
- `app/components/channelPage/channelPage.tsx:230` (JSX text): &nbsp;
- `app/components/channelPage/channelPage.tsx:234` (JSX text): &nbsp;
- `app/components/channelPage/channelPage.tsx:249` (attribute): Sort videos
- `app/components/channelPage/channelPage.tsx:275` (attribute): Sort playlists
- `app/components/editPlaylistPage/editPlaylistPage.tsx:671` (JSX text): Back to My Playlists
- `app/components/editPlaylistPage/editPlaylistPage.tsx:690` (JSX text): Back to My Playlists
- `app/components/editPlaylistPage/editPlaylistPage.tsx:703` (JSX text): Make changes to your playlist details and thumbnail.
- `app/components/editPlaylistPage/editPlaylistPage.tsx:765` (JSX text): videos
- `app/components/editPlaylistPage/editPlaylistPage.tsx:800` (JSX text): MB
- `app/components/editPlaylistPage/editPlaylistPage.tsx:810` (JSX text): Remove
- `app/components/editPlaylistPage/editPlaylistPage.tsx:819` (JSX text): Select file
- `app/components/editPlaylistPage/editPlaylistPage.tsx:864` (JSX text): Cancel
- `app/components/editPlaylistPage/editPlaylistPage.tsx:871` (JSX text): • Unsaved thumbnail changes
- `app/components/editPlaylistPage/editPlaylistPage.tsx:972` (JSX text): Featured playlists can be highlighted in the app.
- `app/components/editPlaylistPage/editPlaylistPage.tsx:980` (JSX text): • Unsaved changes
- `app/components/editPlaylistPage/editPlaylistPage.tsx:994` (JSX text): Saving...
- `app/components/editPlaylistPage/editPlaylistPage.tsx:1054` (JSX text): Adding...
- `app/components/editPlaylistPage/editPlaylistPage.tsx:1059` (JSX text): Add
- `app/components/editPlaylistPage/editPlaylistPage.tsx:1067` (JSX text): No videos found, or all matching videos are already in this playlist.
- `app/components/editPlaylistPage/editPlaylistPage.tsx:1155` (JSX text): Saving playlist order...
- `app/components/editPlaylistPage/editPlaylistPage.tsx:1179` (JSX text): Back to My Playlists
- `app/components/editPlaylistPage/editPlaylistPage.tsx:1182` (JSX text): View Playlist
- `app/components/footer/footer.tsx:78` (JSX text): &nbsp;
- `app/components/footer/footer.tsx:85` (JSX text): &nbsp;-&nbsp;Copyright ©
- `app/components/footer/footer.tsx:85` (JSX text): &nbsp;-&nbsp;All rights reserved
- `app/components/forgotPasswordPage/forgotPasswordPage.tsx:239` (attribute): Background
- `app/components/forgotPasswordPage/forgotPasswordPage.tsx:357` (JSX text): &nbsp;
- `app/components/header/header.tsx:260` (JSX text): 👋&nbsp;
- `app/components/homePage/homePage.tsx:58` (JSX text): OptiFlowz
- `app/components/homePage/slider/slider.tsx:142` (attribute): Hero Image Large
- `app/components/homePage/slider/slider.tsx:145` (attribute): Hero Image Large
- `app/components/homePage/slider/slider.tsx:158` (attribute): Hero slides
- `app/components/itemSlider/item.tsx:38` (attribute): Thumbnail preview
- `app/components/itemSlider/item.tsx:47` (attribute): Thumbnail
- `app/components/itemSlider/playlistItem.tsx:39` (attribute): Thumbnail
- `app/components/itemSlider/playlistItem.tsx:46` (JSX text): &nbsp;
- `app/components/loginPage/loginPage.tsx:199` (attribute): Background
- `app/components/loginPage/loginPage.tsx:226` (attribute): example@gmail.com
- `app/components/loginPage/loginPage.tsx:341` (JSX text): &nbsp;
- `app/components/myPlaylists/playlistRow/playlistRow.tsx:284` (attribute): Thumbnail
- `app/components/myPlaylists/playlistRow/playlistRow.tsx:336` (attribute): Thumbnail
- `app/components/myPlaylists/playlistRow/playlistRow.tsx:402` (JSX text): &nbsp;
- `app/components/myVideosPage/sidebar/sidebar.tsx:31` (attribute): Background
- `app/components/myVideosPage/sidebar/sidebar.tsx:43` (JSX text): &nbsp;
- `app/components/myVideosPage/sidebar/sidebar.tsx:46` (JSX text): &nbsp;
- `app/components/myVideosPage/sidebar/sidebar.tsx:49` (JSX text): &nbsp;
- `app/components/myVideosPage/sidebar/sidebar.tsx:52` (JSX text): &nbsp;
- `app/components/myVideosPage/sidebar/sidebar.tsx:55` (JSX text): &nbsp;
- `app/components/myVideosPage/videoRow/videoRow.tsx:258` (attribute): Thumbnail
- `app/components/myVideosPage/videoRow/videoRow.tsx:315` (attribute): Thumbnail
- `app/components/myVideosPage/videoRow/videoRow.tsx:391` (JSX text): &nbsp;
- `app/components/myVideosPage/videoRow/videoRow.tsx:411` (JSX text): Change visibility
- `app/components/myVideosPage/videoRow/videoRow.tsx:425` (JSX text): Public
- `app/components/myVideosPage/videoRow/videoRow.tsx:438` (JSX text): Private
- `app/components/myVideosPage/videoRow/videoRow.tsx:448` (JSX text): Cancel
- `app/components/myVideosPage/videoRow/videoRow.tsx:455` (JSX text): Save
- `app/components/persistentVideo/persistentVideoProvider.tsx:334` (attribute): Open full video
- `app/components/persistentVideo/persistentVideoProvider.tsx:335` (attribute): Open full video
- `app/components/persistentVideo/persistentVideoProvider.tsx:345` (attribute): Close mini player
- `app/components/persistentVideo/persistentVideoProvider.tsx:346` (attribute): Close mini player
- `app/components/platformPage/sidebar/platformSidebar.tsx:41` (JSX text): &nbsp;
- `app/components/platformPage/sidebar/platformSidebar.tsx:44` (JSX text): &nbsp;
- `app/components/platformPage/sidebar/platformSidebar.tsx:51` (JSX text): &nbsp;
- `app/components/playPage/commentCollection/commentComposer.tsx:65` (attribute): Profile
- `app/components/playPage/playerCollection/chairPopup.tsx:12` (attribute): Profile
- `app/components/playPage/playerCollection/playCard.tsx:29` (attribute): Thumbnail preview
- `app/components/playPage/playerCollection/playCard.tsx:30` (attribute): Thumbnail
- `app/components/playPage/playerCollection/playCard.tsx:47` (JSX text): &nbsp;·&nbsp;
- `app/components/playPage/playerCollection/playingPlaylist.tsx:182` (JSX text): &nbsp;
- `app/components/playPage/playerCollection/playingPlaylist.tsx:183` (JSX text): &nbsp;
- `app/components/playPage/playerCollection/playingPlaylist.tsx:184` (JSX text): &nbsp;
- `app/components/playPage/playerCollection/videoInfo.tsx:491` (attribute): Ask AI
- `app/components/playPage/playerCollection/videoInfo.tsx:493` (JSX text): Ask AI
- `app/components/playPage/playerCollection/videoInfo.tsx:504` (JSX text): Channel:
- `app/components/playPage/playerCollection/videoInfo.tsx:507` (attribute): Profile
- `app/components/playPage/playerCollection/videoInfo.tsx:521` (attribute): Profile
- `app/components/playPage/playerCollection/videoInfo.tsx:536` (attribute): Profile
- `app/components/playlistPage/playlistPage.tsx:207` (JSX text): &nbsp;
- `app/components/playlistPage/playlistPage.tsx:209` (JSX text): &nbsp;
- `app/components/playlistPage/playlistPage.tsx:210` (JSX text): &nbsp;
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:17` (JSX text): Privacy Policy
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:18` (JSX text): Effective date:
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:18` (JSX text): August 25, 2026
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:21` (JSX text): This notice explains how
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:21` (JSX text): , trading as
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:21` (JSX text): , processes personal data when you use
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:22` (JSX text): (the “Platform”). It also explains your choices and data-protection rights. This notice applies to the Platform website, account, video, playlist, quiz, comment, support, and related learning features.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:28` (JSX text): 1) Controller and privacy contact
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:30` (JSX text): Controller:
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:31` (JSX text): 30 N Gould St Ste R, Sheridan, WY 82801, USA
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:32` (JSX text): Website:
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:33` (JSX text): Privacy email:
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:36` (JSX text): Use the privacy email for access, correction, erasure, restriction, portability, objection, consent withdrawal, or questions about this notice. We may need to verify your identity before acting on a request.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:42` (JSX text): 2) Data, purposes, and legal bases
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:47` (JSX text): Data
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:48` (JSX text): Purpose
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:49` (JSX text): Legal basis
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:54` (JSX text): Name, email, authentication data, role, membership status, and optional profile details/photo
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:55` (JSX text): Create and administer your account, authenticate you, provide access, and keep profile details accurate
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:56` (JSX text): Performance of the Platform contract; legitimate interests in account administration and security
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:59` (JSX text): Videos and playlists watched, progress, watch time, quiz attempts, certificates, likes, saves, comments, and searches
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:60` (JSX text): Provide learning continuity and user-requested interactive features
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:61` (JSX text): Performance of the Platform contract
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:64` (JSX text): Viewing and interaction history
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:65` (JSX text): Generate and display personalized recommendations
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:66` (JSX text): Your consent; this feature is off until you enable it and can be disabled at any time
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:69` (JSX text): IP address, device/browser and operating-system details, timestamps, request and security logs
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:70` (JSX text): Deliver the service, prevent abuse, investigate incidents, and maintain reliability
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:71` (JSX text): Legitimate interests in operating and securing the Platform; legal obligations where applicable
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:74` (JSX text): Messages, reports, and support correspondence
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:75` (JSX text): Respond to you, resolve issues, and keep a record of the request
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:76` (JSX text): Performance of the Platform contract; legitimate interests in support and dispute handling
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:79` (JSX text): Technical connection data and prompts sent through the AI assistant
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:80` (JSX text): Display and operate the assistant, then answer messages after you confirm inside the chat
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:81` (JSX text): Legitimate interests in providing the assistant interface; your confirmation and the user-requested service for chat messages
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:87` (JSX text): Profile biography, profile photo, and membership status are optional. Please do not include patient, medical, or other special-category personal data in profiles, comments, uploads, or AI prompts.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:93` (JSX text): 3) Where data comes from
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:95` (JSX text): directly from you when you register, edit your profile, interact with content, or contact us;
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:96` (JSX text): automatically from your browser/device and your use of the Platform;
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:97` (JSX text): from Google if you choose “Continue with Google” (basic identity data needed to sign you in); and
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:98` (JSX text): from an organization that sponsors or administers your access, where applicable.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:103` (JSX text): 4) What is required
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:105` (JSX text): Name, email, password or third-party sign-in credentials, and acceptance of the Terms are required to create a standard account. If you do not provide them, we cannot create or authenticate the account. Optional profile fields and personalization are not required to use the core Platform. The AI assistant is available as an optional user-invoked feature.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:113` (JSX text): 5) Recipients and processors
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:114` (JSX text): We disclose personal data only where needed to operate the Platform or meet legal obligations:
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:116` (JSX text): Mux
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:116` (JSX text): , for video hosting, delivery, playback, and related technical video services;
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:117` (JSX text): Google
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:117` (JSX text): , only when you choose Google sign-in;
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:119` (JSX text): the
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:119` (JSX text): AI assistant provider
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:119` (JSX text): at ai-chatbot-platform.fly.dev, which delivers the assistant interface and processes chat messages after you confirm inside the chat;
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:122` (JSX text): hosting, infrastructure, email, security, and support providers acting under contractual instructions;
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:124` (JSX text): your sponsoring organization or content partner, where applicable, for access administration and reporting; user-level details are limited to what is necessary, and reporting should be aggregated where possible; and
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:127` (JSX text): courts, regulators, law enforcement, or other parties where law requires it or legal claims make it necessary.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:129` (JSX text): We do not sell personal data or use it for third-party behavioral advertising.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:133` (JSX text): 6) Cookies, local storage, and optional services
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:135` (JSX text): The Platform uses browser storage for authentication/session state, language, autoplay, navigation continuity, and your privacy choices. These items are necessary to provide settings or functions you request. The privacy choice record contains the preference version, selected categories, and the time the choice was saved.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:140` (JSX text): Personalized recommendations remain disabled until you choose them. The AI assistant launcher is available by default and its provider can receive technical connection data, such as your IP address and browser/device information, to deliver the widget. Before using the chat, the widget asks you to confirm its privacy notice. Anything you submit is sent to the assistant provider. Do not submit patient or other sensitive personal data.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:151` (JSX text): 7) Personalization and automated processing
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:153` (JSX text): If you enable personalization, automated methods use viewing and interaction history to rank or suggest content. This does not produce legal or similarly significant effects. You can turn personalization off at any time in Privacy choices; the Platform will then stop requesting and displaying personalized recommendations.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:160` (JSX text): 8) Retention
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:161` (JSX text): We apply the following retention criteria:
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:163` (JSX text): Account and profile data:
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:163` (JSX text): while the account is active, then only as needed for legal obligations, security, fraud prevention, or legal claims.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:164` (JSX text): Learning and interaction data:
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:164` (JSX text): while needed to provide progress, history, certificates, playlists, comments, and other account features, subject to a valid rights request.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:165` (JSX text): Authentication, security, and audit logs:
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:165` (JSX text): for the shortest period needed to detect and investigate security or abuse and meet documented legal requirements.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:166` (JSX text): Support and rights-request records:
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:166` (JSX text): until the matter is closed, then for the period needed to demonstrate that the request was handled and manage legal claims.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:167` (JSX text): Privacy choices:
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:167` (JSX text): until you replace the choice, clear browser storage, or the preference version changes.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:170` (JSX text): Data may remain in restricted backups until the normal backup cycle replaces it. The operator maintains the detailed retention schedule used to turn these criteria into operational deletion periods.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:176` (JSX text): 9) International transfers
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:178` (JSX text): The controller is in the United States, and some providers may process data outside the European Economic Area. Where GDPR transfer restrictions apply, transfers must rely on an adequacy decision or appropriate safeguards, such as the European Commission’s Standard Contractual Clauses, together with supplementary measures where required. Contact
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:181` (JSX text): to ask about the safeguard relevant to your data or request a copy.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:186` (JSX text): 10) Your rights
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:187` (JSX text): Where GDPR applies, and subject to its conditions and exceptions, you can:
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:189` (JSX text): ask whether we process your data and receive access and a copy;
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:190` (JSX text): correct inaccurate or incomplete data;
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:191` (JSX text): request erasure or restriction of processing;
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:192` (JSX text): receive data you provided in a structured, commonly used, machine-readable format and request transfer where technically feasible;
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:193` (JSX text): object to processing based on legitimate interests;
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:194` (JSX text): withdraw consent at any time, without affecting earlier lawful processing; and
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:195` (JSX text): lodge a complaint with the data protection authority where you live or work, or where the alleged infringement occurred.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:198` (JSX text): Edit profile data from your account page, manage optional processing through Privacy choices, or send any rights request to
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:199` (JSX text): . We normally respond without undue delay and within one month. You can find EU supervisory authorities through the
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:201` (JSX text): European Data Protection Board member list
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:206` (JSX text): 11) Security
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:208` (JSX text): We use technical and organizational safeguards appropriate to risk, including access controls, encryption in transit, authentication, service monitoring, backups, and incident handling. No internet service can guarantee absolute security. Please use a unique password and notify us if you believe your account is compromised.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:215` (JSX text): 12) Children
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:217` (JSX text): The Platform is intended for professional education and is not directed to children. Account holders must be at least 18 years old or the age of majority in their country, whichever is higher. Contact us if you believe a child provided personal data contrary to this requirement.
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:224` (JSX text): 13) Changes to this notice
- `app/components/privacyPolicyPage/privacyPolicyPage.tsx:226` (JSX text): We may update this notice to reflect service, legal, or processing changes. We will post the new effective date here and provide a prominent in-product or email notice when a change materially affects how personal data is used.
- `app/components/registerPage/registerPage.tsx:198` (attribute): Background
- `app/components/registerPage/registerPage.tsx:369` (JSX text): &nbsp;
- `app/components/searchPage/verticalSlider/item.tsx:21` (attribute): Thumbnail preview
- `app/components/searchPage/verticalSlider/item.tsx:22` (attribute): Thumbnail
- `app/components/termsOfUsePage/termsOfUsePage.tsx:6` (JSX text): Terms of Use
- `app/components/termsOfUsePage/termsOfUsePage.tsx:7` (JSX text): Effective date:
- `app/components/termsOfUsePage/termsOfUsePage.tsx:7` (JSX text): January 3, 2026
- `app/components/termsOfUsePage/termsOfUsePage.tsx:10` (JSX text): Welcome to
- `app/components/termsOfUsePage/termsOfUsePage.tsx:10` (JSX text): (the “
- `app/components/termsOfUsePage/termsOfUsePage.tsx:10` (JSX text): Platform
- `app/components/termsOfUsePage/termsOfUsePage.tsx:10` (JSX text): ”), an educational video platform provided by
- `app/components/termsOfUsePage/termsOfUsePage.tsx:11` (JSX text): we
- `app/components/termsOfUsePage/termsOfUsePage.tsx:11` (JSX text): us
- `app/components/termsOfUsePage/termsOfUsePage.tsx:11` (JSX text): our
- `app/components/termsOfUsePage/termsOfUsePage.tsx:11` (JSX text): ”). These Terms of Use (“
- `app/components/termsOfUsePage/termsOfUsePage.tsx:12` (JSX text): Terms
- `app/components/termsOfUsePage/termsOfUsePage.tsx:12` (JSX text): ”) govern your access to and use of the Platform, including videos, playlists, recommendations, and related features.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:17` (JSX text): By creating an account, accessing, or using the Platform, you agree to these Terms. If you do not agree, do not use the Platform.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:21` (JSX text): 1) Who the Platform is for
- `app/components/termsOfUsePage/termsOfUsePage.tsx:24` (JSX text): The Platform is intended for
- `app/components/termsOfUsePage/termsOfUsePage.tsx:24` (JSX text): healthcare professionals
- `app/components/termsOfUsePage/termsOfUsePage.tsx:24` (JSX text): and individuals involved in surgical education/training.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:27` (JSX text): You confirm that you are at least
- `app/components/termsOfUsePage/termsOfUsePage.tsx:27` (JSX text): 18 years old
- `app/components/termsOfUsePage/termsOfUsePage.tsx:27` (JSX text): (or the age of majority in your country, whichever is higher).
- `app/components/termsOfUsePage/termsOfUsePage.tsx:30` (JSX text): You are responsible for ensuring your use complies with your local laws, professional rules, and institutional policies.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:36` (JSX text): 2) Educational purpose & medical disclaimer
- `app/components/termsOfUsePage/termsOfUsePage.tsx:39` (JSX text): The Platform provides educational material for professional learning. It is
- `app/components/termsOfUsePage/termsOfUsePage.tsx:39` (JSX text): not
- `app/components/termsOfUsePage/termsOfUsePage.tsx:39` (JSX text): a substitute for formal surgical training, clinical judgment, supervision, credentialing, or local protocols.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:43` (JSX text): Content may describe techniques, devices, or approaches that are not appropriate for every patient or setting and may evolve over time.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:46` (JSX text): The Platform does
- `app/components/termsOfUsePage/termsOfUsePage.tsx:46` (JSX text): not
- `app/components/termsOfUsePage/termsOfUsePage.tsx:46` (JSX text): provide medical advice and should not be used for emergency decision-making or patient-specific care.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:52` (JSX text): 3) Accounts, security, and access
- `app/components/termsOfUsePage/termsOfUsePage.tsx:54` (JSX text): You may need an account to watch videos, use playlists, and access personalized features.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:55` (JSX text): You agree to provide accurate information and keep it up to date.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:56` (JSX text): You are responsible for maintaining the confidentiality of your login credentials and for all activity under your account.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:58` (JSX text): We may suspend or restrict access if we reasonably believe your account is compromised, used in violation of these Terms, or poses a security risk.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:64` (JSX text): 4) Platform features (watch tracking, likes, saves, sharing, recommendations)
- `app/components/termsOfUsePage/termsOfUsePage.tsx:66` (JSX text): The Platform may allow you to:
- `app/components/termsOfUsePage/termsOfUsePage.tsx:69` (JSX text): watch videos and playlists;
- `app/components/termsOfUsePage/termsOfUsePage.tsx:70` (JSX text): save videos/playlists, like/dislike content, and manage your learning library;
- `app/components/termsOfUsePage/termsOfUsePage.tsx:71` (JSX text): share links to videos or playlists (where sharing is enabled);
- `app/components/termsOfUsePage/termsOfUsePage.tsx:72` (JSX text): receive recommendations based on your viewing activity and interactions.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:76` (JSX text): Tracking and analytics:
- `app/components/termsOfUsePage/termsOfUsePage.tsx:76` (JSX text): To support learning features and Platform improvement, we may collect and process usage data such as: videos watched, watch time, session activity, likes/dislikes, saves, shares, search and browsing actions, and playlist progress. We may use this data to generate personal statistics, personalized recommendations, and aggregated platform reporting.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:82` (JSX text): For details on personal data, cookies, retention, and your rights, please refer to our
- `app/components/termsOfUsePage/termsOfUsePage.tsx:82` (JSX text): Privacy Notice / Data Protection Notice
- `app/components/termsOfUsePage/termsOfUsePage.tsx:83` (JSX text): (available on the Platform website).
- `app/components/termsOfUsePage/termsOfUsePage.tsx:88` (JSX text): 5) Acceptable use
- `app/components/termsOfUsePage/termsOfUsePage.tsx:89` (JSX text): You agree not to:
- `app/components/termsOfUsePage/termsOfUsePage.tsx:91` (JSX text): use the Platform for unlawful, misleading, or harmful purposes;
- `app/components/termsOfUsePage/termsOfUsePage.tsx:92` (JSX text): attempt to access content or accounts without authorization, or bypass access controls;
- `app/components/termsOfUsePage/termsOfUsePage.tsx:93` (JSX text): copy, record, download, capture, redistribute, re-upload, sell, sublicense, or publicly display videos or materials without permission;
- `app/components/termsOfUsePage/termsOfUsePage.tsx:94` (JSX text): scrape or harvest data from the Platform using automated tools (bots/crawlers) without written authorization;
- `app/components/termsOfUsePage/termsOfUsePage.tsx:95` (JSX text): introduce malware, disrupt the Platform, or test vulnerabilities without permission;
- `app/components/termsOfUsePage/termsOfUsePage.tsx:96` (JSX text): impersonate another person or misrepresent your professional affiliation or credentials.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:101` (JSX text): 6) Professional conduct & patient confidentiality
- `app/components/termsOfUsePage/termsOfUsePage.tsx:104` (JSX text): Do not post or share
- `app/components/termsOfUsePage/termsOfUsePage.tsx:104` (JSX text): patient-identifying information
- `app/components/termsOfUsePage/termsOfUsePage.tsx:104` (JSX text): anywhere on the Platform (including comments, descriptions, or uploads), unless the Platform explicitly provides a compliant workflow and you have all necessary rights and consents.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:108` (JSX text): If interactive features exist (e.g., comments, discussions), you agree to be respectful and professional. Harassment, hate, threats, or discriminatory content are not allowed.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:112` (JSX text): We may remove content or restrict features to protect users, patients, the platform operator, or the integrity of the Platform.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:118` (JSX text): 7) Intellectual property
- `app/components/termsOfUsePage/termsOfUsePage.tsx:121` (JSX text): The Platform and its content (videos, audio, text, graphics, branding, software, and design) are owned by OptiFlowz or its licensors and are protected by intellectual property laws.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:125` (JSX text): Subject to these Terms, we grant you a limited, non-exclusive, non-transferable, revocable license to access and view content for your personal professional education (non-commercial use), unless a specific written license states otherwise.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:129` (JSX text): Any rights not expressly granted are reserved by OptiFlowz and its licensors.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:135` (JSX text): 8) User content (only if enabled)
- `app/components/termsOfUsePage/termsOfUsePage.tsx:137` (JSX text): If the Platform allows you to submit content (e.g., comments, feedback, ratings, or uploads) (“
- `app/components/termsOfUsePage/termsOfUsePage.tsx:137` (JSX text): User Content
- `app/components/termsOfUsePage/termsOfUsePage.tsx:140` (JSX text): You retain ownership of your User Content.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:142` (JSX text): You grant OptiFlowz a worldwide, non-exclusive, royalty-free license to host, store, reproduce, display, and distribute your User Content only as necessary to operate, maintain, and improve the Platform (and for moderation, security, and legal compliance).
- `app/components/termsOfUsePage/termsOfUsePage.tsx:145` (JSX text): You confirm you have all rights needed to submit the User Content and that it does not infringe third-party rights.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:150` (JSX text): 9) Third-party services
- `app/components/termsOfUsePage/termsOfUsePage.tsx:152` (JSX text): The Platform may include links or integrations with third-party services (e.g., embedded players or analytics providers). Third parties may have their own terms and policies. We are not responsible for third-party services.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:158` (JSX text): 10) Changes to the Platform or Terms
- `app/components/termsOfUsePage/termsOfUsePage.tsx:160` (JSX text): We may update the Platform (features, content availability, access levels) at any time.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:162` (JSX text): We may update these Terms from time to time. Updated Terms will be posted on this page with a new effective date. Continued use after changes means you accept the updated Terms.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:169` (JSX text): 11) Suspension and termination
- `app/components/termsOfUsePage/termsOfUsePage.tsx:171` (JSX text): We may suspend or terminate your access (in whole or in part) if you violate these Terms, if required by law, or if your use poses a security, legal, or reputational risk to the platform operator or users. You may stop using the Platform at any time.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:177` (JSX text): 12) Disclaimers
- `app/components/termsOfUsePage/termsOfUsePage.tsx:179` (JSX text): The Platform is provided on an “as is” and “as available” basis. To the fullest extent permitted by law, we disclaim warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not guarantee uninterrupted, error-free, or permanently available content.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:185` (JSX text): 13) Limitation of liability
- `app/components/termsOfUsePage/termsOfUsePage.tsx:187` (JSX text): To the fullest extent permitted by law,
- `app/components/termsOfUsePage/termsOfUsePage.tsx:187` (JSX text): will not be liable for indirect, incidental, special, consequential, or punitive damages, or for loss of profits, data, goodwill, or other intangible losses, arising out of or related to your use of (or inability to use) the Platform.
- `app/components/termsOfUsePage/termsOfUsePage.tsx:193` (JSX text): 14) Governing law and jurisdiction
- `app/components/termsOfUsePage/termsOfUsePage.tsx:195` (JSX text): These Terms are governed by
- `app/components/termsOfUsePage/termsOfUsePage.tsx:195` (JSX text): French law
- `app/components/termsOfUsePage/termsOfUsePage.tsx:195` (JSX text): . Unless mandatory consumer/professional protections require otherwise, disputes will be subject to the competent courts in
- `app/components/termsOfUsePage/termsOfUsePage.tsx:196` (JSX text): Toulouse, France
- `app/components/termsOfUsePage/termsOfUsePage.tsx:201` (JSX text): 15) Contact
- `app/components/termsOfUsePage/termsOfUsePage.tsx:204` (JSX text): 30 N Gould St Ste R, Sheridan, WY 82801, USA
- `app/components/termsOfUsePage/termsOfUsePage.tsx:205` (JSX text): Email:
- `app/components/termsOfUsePage/termsOfUsePage.tsx:206` (JSX text): Monday-Friday 09:00-17:00
- `app/components/uemsPage/uemsPage.tsx:118` (JSX text): UEMS
- `app/components/uemsPage/uemsPage.tsx:118` (JSX text): Reading List
- `app/components/uemsPage/uemsPage.tsx:122` (JSX text): Direct links to the UEMS MIS and robotics reading materials.
- `app/components/uemsPage/uemsPage.tsx:126` (JSX text): Open a paper directly or use the PDF link for the original full list.
- `app/components/uemsPage/uemsPage.tsx:130` (JSX text): Nothing extra on the page beyond the reading links themselves.
- `app/components/uemsPage/uemsPage.tsx:134` (JSX text): Direct links to the UEMS MIS and robotics reading materials.
- `app/components/uploadPage/uploadPage.tsx:1505` (JSX text): MB
- `app/opengraph-image.tsx:36` (JSX text): OptiFlowz
- `app/opengraph-image.tsx:39` (JSX text): Video content, organized.
- `app/opengraph-image.tsx:42` (JSX text): Professional videos, playlists, and learning resources.

</details>

## Limits

This is a source and catalogue audit, not a native-speaker review of every message or a browser walkthrough in every language. Matching-English checks catch copied English but cannot reliably detect partially translated sentences or other language-quality issues. No claim is made that the entire platform is now fully localized.
