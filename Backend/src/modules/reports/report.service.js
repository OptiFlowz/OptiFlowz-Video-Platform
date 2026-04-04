import puppeteer from 'puppeteer';
import { readPool } from '../../database/index.js';

const FRONTEND_VIDEO_BASE = 'https://videoplatform.optiflowz.com/video/';
const REPORT_LOGO_URL = 'https://videoplatform.optiflowz.com/_next/static/media/OptiFlowzLogo.6e965059.webp';
function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fmtNum(value = 0) {
  return Number(value || 0).toLocaleString('en-GB');
}

function fmtPct(value = 0, digits = 1) {
  return `${Number(value || 0).toFixed(digits)}%`;
}

function fmtHMS(seconds = 0) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function shortLabel(text = '', max = 26) {
  const str = String(text || '');
  if (str.length <= max) return str;
  return `${str.slice(0, max - 1)}…`;
}

function resolveCountryIso2(countryIso = '') {
  const iso2 = String(countryIso || '').trim();
  if (!/^[A-Za-z]{2}$/.test(iso2)) return null;
  return iso2.toUpperCase();
}

function getFlagImageUrl(countryIso = '') {
  const iso2 = resolveCountryIso2(countryIso);
  if (!iso2) return null;
  return `https://flagcdn.com/w40/${iso2.toLowerCase()}.png`;
}

function formatDateLabel(dateLike, groupBy = 'day') {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '';

  if (groupBy === 'month') {
    return d.toLocaleDateString('en-GB', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  if (groupBy === 'week') {
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    });
  }

  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

function safeDateInputToUtcStart(dateStr) {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function safeDateInputToUtcEnd(dateStr) {
  return new Date(`${dateStr}T23:59:59.999Z`);
}

function resolveGroupBy(requested, from, to) {
  if (requested && requested !== 'auto') {
    if (!['day', 'week', 'month'].includes(requested)) {
      throw new Error('Invalid groupBy. Allowed values: auto, day, week, month');
    }
    return requested;
  }

  if (!from || !to) return 'month';

  const diffMs = to.getTime() - from.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 45) return 'day';
  if (diffDays <= 180) return 'week';
  return 'month';
}

function normalizeReportOptions(raw = {}) {
  const now = new Date();
  const range = String(raw.range || 'lifetime').toLowerCase();

  let from = null;
  let to = null;
  let label = 'Lifetime';

  if (range === 'last7') {
    from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 7);
    to = now;
    label = 'Last 7 days';
  } else if (range === 'last30') {
    from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 30);
    to = now;
    label = 'Last 30 days';
  } else if (range === 'last90') {
    from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 90);
    to = now;
    label = 'Last 90 days';
  } else if (range === 'last365') {
    from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 365);
    to = now;
    label = 'Last 12 months';
  } else if (range === 'custom') {
    if (!raw.from || !raw.to) {
      throw new Error('For range=custom you must provide from and to in YYYY-MM-DD format');
    }

    from = safeDateInputToUtcStart(raw.from);
    to = safeDateInputToUtcEnd(raw.to);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new Error('Invalid custom range. Use YYYY-MM-DD format');
    }

    if (from > to) {
      throw new Error('"from" must be before or equal to "to"');
    }

    label = `${raw.from} → ${raw.to}`;
  } else if (range !== 'lifetime') {
    throw new Error('Invalid range. Allowed: lifetime, last7, last30, last90, last365, custom');
  }

  const groupBy = resolveGroupBy(raw.groupBy || 'auto', from, to);

  return {
    range,
    from,
    to,
    label,
    groupBy,
    includePrivate: raw.includePrivate === true || raw.includePrivate === 'true',
    timezone: raw.timezone || 'UTC',
  };
}

function dateFilter(column) {
  return `($1::timestamptz IS NULL OR ${column} >= $1) AND ($2::timestamptz IS NULL OR ${column} <= $2)`;
}

function getBucketExpr(groupBy, column) {
  if (groupBy === 'month') return `date_trunc('month', ${column})`;
  if (groupBy === 'week') return `date_trunc('week', ${column})`;
  return `date_trunc('day', ${column})`;
}

function publicVideosCondition(alias = 'v', includePrivate = false) {
  return includePrivate ? 'TRUE' : `${alias}.visibility = 'public'`;
}

function publicPlaylistsCondition(alias = 'p', includePrivate = false) {
  return includePrivate ? 'TRUE' : `${alias}.status = 'public'`;
}

function getOverviewSql(includePrivate = false) {
  const videoCondition = publicVideosCondition('v', includePrivate);
  const playlistCondition = publicPlaylistsCondition('p', includePrivate);

  return `
    SELECT
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(*) FROM users WHERE eaes_member = true) AS eaes_members,
      (SELECT COUNT(*) FROM users WHERE ${dateFilter('created_at')}) AS new_users_in_period,

      (SELECT COUNT(*) FROM videos v WHERE ${videoCondition}) AS total_videos,
      (SELECT COUNT(*) FROM playlists p WHERE ${playlistCondition}) AS total_playlists,

      (
        SELECT COUNT(*)
        FROM video_views vv
        JOIN videos v ON v.id = vv.video_id
        WHERE ${videoCondition}
          AND ${dateFilter('vv.created_at')}
      ) AS total_video_views,

      (
        SELECT COUNT(DISTINCT vv.user_id)
        FROM video_views vv
        JOIN videos v ON v.id = vv.video_id
        WHERE vv.user_id IS NOT NULL
          AND ${videoCondition}
          AND ${dateFilter('vv.created_at')}
      ) AS unique_video_viewers,

      (
        SELECT COALESCE(SUM(vv.watch_duration), 0)
        FROM video_views vv
        JOIN videos v ON v.id = vv.video_id
        WHERE ${videoCondition}
          AND ${dateFilter('vv.created_at')}
      ) AS total_watch_seconds,

      (
        SELECT COUNT(*)
        FROM video_views vv
        JOIN users u ON u.id = vv.user_id
        JOIN videos v ON v.id = vv.video_id
        WHERE u.eaes_member = true
          AND ${videoCondition}
          AND ${dateFilter('vv.created_at')}
      ) AS eaes_member_video_views,

      (
        SELECT COUNT(*)
        FROM video_views vv
        JOIN users u ON u.id = vv.user_id
        JOIN videos v ON v.id = vv.video_id
        WHERE u.eaes_member = false
          AND ${videoCondition}
          AND ${dateFilter('vv.created_at')}
      ) AS non_member_video_views,

      (
        SELECT COUNT(*)
        FROM video_views vv
        JOIN videos v ON v.id = vv.video_id
        WHERE vv.user_id IS NULL
          AND ${videoCondition}
          AND ${dateFilter('vv.created_at')}
      ) AS anonymous_video_views,

      (
        SELECT COUNT(*)
        FROM playlist_views pv
        JOIN playlists p ON p.id = pv.playlist_id
        WHERE ${playlistCondition}
          AND ${dateFilter('pv.created_at')}
      ) AS total_playlist_views,

      (
        SELECT COUNT(DISTINCT pv.user_id)
        FROM playlist_views pv
        JOIN playlists p ON p.id = pv.playlist_id
        WHERE pv.user_id IS NOT NULL
          AND ${playlistCondition}
          AND ${dateFilter('pv.created_at')}
      ) AS unique_playlist_viewers,

      (
        SELECT COUNT(*)
        FROM playlist_saves ps
        JOIN playlists p ON p.id = ps.playlist_id
        WHERE ${playlistCondition}
          AND ${dateFilter('ps.created_at')}
      ) AS total_playlist_saves,

      (
        SELECT COUNT(*)
        FROM video_reactions vr
        JOIN videos v ON v.id = vr.video_id
        WHERE ${videoCondition}
          AND ${dateFilter('vr.created_at')}
      ) AS total_reactions,

      (
        SELECT COUNT(*)
        FROM video_reactions vr
        JOIN videos v ON v.id = vr.video_id
        WHERE vr.reaction = 1
          AND ${videoCondition}
          AND ${dateFilter('vr.created_at')}
      ) AS total_likes,

      (
        SELECT COUNT(*)
        FROM video_reactions vr
        JOIN videos v ON v.id = vr.video_id
        WHERE vr.reaction = -1
          AND ${videoCondition}
          AND ${dateFilter('vr.created_at')}
      ) AS total_dislikes,

      (
        SELECT COUNT(*)
        FROM video_comments vc
        JOIN videos v ON v.id = vc.video_id
        WHERE vc.is_deleted = false
          AND ${videoCondition}
          AND ${dateFilter('vc.created_at')}
      ) AS total_comments
  `;
}

function getVideoTimelineSql(groupBy, includePrivate = false) {
  const bucket = getBucketExpr(groupBy, 'vv.created_at');
  const videoCondition = publicVideosCondition('v', includePrivate);

  return `
    SELECT
      ${bucket} AS bucket,
      COUNT(*) AS views,
      COUNT(DISTINCT vv.user_id) AS unique_users,
      COALESCE(SUM(vv.watch_duration), 0) AS watch_seconds
    FROM video_views vv
    JOIN videos v ON v.id = vv.video_id
    WHERE ${videoCondition}
      AND ${dateFilter('vv.created_at')}
    GROUP BY 1
    ORDER BY 1
  `;
}

function getActiveUsersTimelineSql(groupBy, includePrivate = false) {
  const bucket = getBucketExpr(groupBy, 'activity.created_at');
  const videoCondition = publicVideosCondition('v', includePrivate);
  const playlistCondition = publicPlaylistsCondition('p', includePrivate);

  return `
    WITH activity AS (
      SELECT vv.user_id, vv.created_at
      FROM video_views vv
      JOIN videos v ON v.id = vv.video_id
      WHERE vv.user_id IS NOT NULL
        AND ${videoCondition}
        AND ${dateFilter('vv.created_at')}

      UNION ALL

      SELECT pv.user_id, pv.created_at
      FROM playlist_views pv
      JOIN playlists p ON p.id = pv.playlist_id
      WHERE pv.user_id IS NOT NULL
        AND ${playlistCondition}
        AND ${dateFilter('pv.created_at')}
    )
    SELECT
      ${bucket} AS bucket,
      COUNT(DISTINCT activity.user_id) AS active_users
    FROM activity
    GROUP BY 1
    ORDER BY 1
  `;
}

function getUserSignupsTimelineSql(groupBy) {
  const bucket = getBucketExpr(groupBy, 'u.created_at');

  return `
    SELECT
      ${bucket} AS bucket,
      COUNT(*) AS signups
    FROM users u
    WHERE ${dateFilter('u.created_at')}
    GROUP BY 1
    ORDER BY 1
  `;
}

function getDeviceBreakdownSql(includePrivate = false) {
  const videoCondition = publicVideosCondition('v', includePrivate);

  return `
    WITH raw AS (
      SELECT
        COALESCE(vv.user_agent, '') AS user_agent,
        COALESCE((regexp_match(COALESCE(vv.user_agent, ''), '\\\\(([^)]*)\\\\)'))[1], COALESCE(vv.user_agent, '')) AS ua_core
      FROM video_views vv
      JOIN videos v ON v.id = vv.video_id
      WHERE ${videoCondition}
        AND ${dateFilter('vv.created_at')}
    ),
    classified AS (
      SELECT
        CASE
          WHEN ua_core ILIKE '%ipad%' OR ua_core ILIKE '%tablet%' THEN 'tablet'
          WHEN ua_core ILIKE '%iphone%' OR ua_core ILIKE '%android%' THEN 'phone'
          WHEN ua_core ILIKE '%windows%' OR ua_core ILIKE '%macintosh%' OR ua_core ILIKE '%linux%' THEN 'desktop'
          ELSE 'other'
        END AS device_type,
        CASE
          WHEN ua_core ILIKE '%iphone%' OR ua_core ILIKE '%ipad%' OR ua_core ILIKE '%cpu iphone os%' THEN 'iOS'
          WHEN ua_core ILIKE '%android%' THEN 'Android'
          WHEN ua_core ILIKE '%windows nt%' OR ua_core ILIKE '%windows%' THEN 'Windows'
          WHEN ua_core ILIKE '%macintosh%' OR ua_core ILIKE '%mac os x%' THEN 'macOS'
          WHEN ua_core ILIKE '%linux%' THEN 'Linux'
          ELSE 'Other'
        END AS os_name
      FROM raw
    )
    SELECT
      device_type,
      os_name,
      COUNT(*) AS cnt
    FROM classified
    GROUP BY 1, 2
    ORDER BY cnt DESC
  `;
}

function getGeographyBreakdownSql(includePrivate = false) {
  const videoCondition = publicVideosCondition('v', includePrivate);

  return `
    SELECT
      COALESCE(NULLIF(TRIM(vv.country), ''), 'Unknown') AS country,
      COALESCE(NULLIF(TRIM(vv.country_iso), ''), '') AS country_iso,
      COALESCE(NULLIF(TRIM(vv.city), ''), 'Unknown city') AS city,
      COUNT(*) AS cnt
    FROM video_views vv
    JOIN videos v ON v.id = vv.video_id
    WHERE ${videoCondition}
      AND ${dateFilter('vv.created_at')}
    GROUP BY 1, 2, 3
    ORDER BY country ASC, cnt DESC, city ASC
  `;
}

function getTopVideosSql(includePrivate = false) {
  const videoCondition = publicVideosCondition('v', includePrivate);

  return `
    WITH filtered_views AS (
      SELECT
        vv.video_id,
        vv.user_id,
        vv.watch_duration,
        COALESCE(vv.user_agent, '') AS user_agent,
        COALESCE((regexp_match(COALESCE(vv.user_agent, ''), '\\\\(([^)]*)\\\\)'))[1], COALESCE(vv.user_agent, '')) AS ua_core
      FROM video_views vv
      JOIN videos v ON v.id = vv.video_id
      WHERE ${videoCondition}
        AND ${dateFilter('vv.created_at')}
    ),
    classified AS (
      SELECT
        fv.video_id,
        fv.user_id,
        fv.watch_duration,
        CASE
          WHEN fv.ua_core ILIKE '%ipad%' OR fv.ua_core ILIKE '%tablet%' THEN 'tablet'
          WHEN fv.ua_core ILIKE '%iphone%' OR fv.ua_core ILIKE '%android%' THEN 'phone'
          WHEN fv.ua_core ILIKE '%windows%' OR fv.ua_core ILIKE '%macintosh%' OR fv.ua_core ILIKE '%linux%' THEN 'desktop'
          ELSE 'other'
        END AS device_type
      FROM filtered_views fv
    ),
    per_user AS (
      SELECT
        c.video_id,
        c.user_id,
        SUM(c.watch_duration) AS user_watch_seconds
      FROM classified c
      GROUP BY c.video_id, c.user_id
    ),
    per_video_user_avg AS (
      SELECT
        pu.video_id,
        AVG(pu.user_watch_seconds) AS avg_user_watch_seconds
      FROM per_user pu
      GROUP BY pu.video_id
    ),
    filtered_reactions AS (
      SELECT
        vr.video_id,
        COUNT(*) FILTER (WHERE vr.reaction = 1) AS likes,
        COUNT(*) FILTER (WHERE vr.reaction = -1) AS dislikes
      FROM video_reactions vr
      JOIN videos v ON v.id = vr.video_id
      WHERE ${videoCondition}
        AND ${dateFilter('vr.created_at')}
      GROUP BY vr.video_id
    ),
    filtered_comments AS (
      SELECT
        vc.video_id,
        COUNT(*) AS comments
      FROM video_comments vc
      JOIN videos v ON v.id = vc.video_id
      WHERE vc.is_deleted = false
        AND ${videoCondition}
        AND ${dateFilter('vc.created_at')}
      GROUP BY vc.video_id
    ),
    progress_stats AS (
      SELECT
        wp.video_id,
        AVG(wp.percentage_watched) AS avg_percentage_watched
      FROM watch_progress wp
      JOIN videos v ON v.id = wp.video_id
      WHERE ${videoCondition}
        AND ${dateFilter('wp.last_watched_at')}
      GROUP BY wp.video_id
    )
    SELECT
      v.id AS video_id,
      v.title,
      v.thumbnail_url,
      v.duration_seconds,

      COUNT(c.video_id) AS total_views,
      COUNT(DISTINCT c.user_id) AS unique_users,
      COALESCE(SUM(c.watch_duration), 0) AS total_watch_seconds,
      ROUND(COALESCE(SUM(c.watch_duration), 0) / 3600.0, 2) AS total_watch_hours,

      ROUND(COALESCE(AVG(c.watch_duration), 0)::numeric, 2) AS avg_watch_seconds_per_view,
      ROUND(COALESCE(pvua.avg_user_watch_seconds, 0)::numeric, 2) AS avg_watch_seconds_per_user,

      ROUND(
        COALESCE(
          100.0 * SUM(c.watch_duration)
          / NULLIF(COUNT(c.video_id) * NULLIF(v.duration_seconds, 0), 0),
          0
        )::numeric,
        2
      ) AS engagement_rate,

      ROUND(COALESCE(ps.avg_percentage_watched, 0)::numeric, 2) AS avg_percentage_watched,

      SUM(CASE WHEN c.device_type = 'phone' THEN 1 ELSE 0 END) AS phone_views,
      SUM(CASE WHEN c.device_type = 'desktop' THEN 1 ELSE 0 END) AS desktop_views,
      SUM(CASE WHEN c.device_type = 'tablet' THEN 1 ELSE 0 END) AS tablet_views,
      SUM(CASE WHEN c.device_type = 'other' THEN 1 ELSE 0 END) AS other_device_views,

      COALESCE(fr.likes, 0) AS likes,
      COALESCE(fr.dislikes, 0) AS dislikes,
      COALESCE(fc.comments, 0) AS comments
    FROM videos v
    LEFT JOIN classified c ON c.video_id = v.id
    LEFT JOIN per_video_user_avg pvua ON pvua.video_id = v.id
    LEFT JOIN filtered_reactions fr ON fr.video_id = v.id
    LEFT JOIN filtered_comments fc ON fc.video_id = v.id
    LEFT JOIN progress_stats ps ON ps.video_id = v.id
    WHERE ${videoCondition}
    GROUP BY
      v.id,
      v.title,
      v.thumbnail_url,
      v.duration_seconds,
      pvua.avg_user_watch_seconds,
      fr.likes,
      fr.dislikes,
      fc.comments,
      ps.avg_percentage_watched
    ORDER BY total_watch_seconds DESC, total_views DESC, v.title ASC
  `;
}

function getPlaylistPerformanceSql(includePrivate = false) {
  const playlistCondition = publicPlaylistsCondition('p', includePrivate);

  return `
    WITH playlist_video_counts AS (
      SELECT
        pi.playlist_id,
        COUNT(DISTINCT pi.video_id) AS videos
      FROM playlist_items pi
      GROUP BY pi.playlist_id
    ),
    playlist_user_counts AS (
      SELECT
        pv.playlist_id,
        COUNT(DISTINCT pv.user_id) FILTER (
          WHERE ${dateFilter('pv.created_at')}
        ) AS unique_users
      FROM playlist_views pv
      GROUP BY pv.playlist_id
    ),
    playlist_view_counts AS (
      SELECT
        pv.playlist_id,
        COUNT(*) FILTER (
          WHERE ${dateFilter('pv.created_at')}
        ) AS total_views
      FROM playlist_views pv
      GROUP BY pv.playlist_id
    ),
    playlist_save_counts AS (
      SELECT
        ps.playlist_id,
        COUNT(*) FILTER (
          WHERE ${dateFilter('ps.created_at')}
        ) AS total_saves
      FROM playlist_saves ps
      GROUP BY ps.playlist_id
    ),
    classified_views AS (
      SELECT
        pv.playlist_id,
        CASE
          WHEN COALESCE((regexp_match(COALESCE(pv.user_agent, ''), '\\\\(([^)]*)\\\\)'))[1], COALESCE(pv.user_agent, '')) ILIKE '%ipad%'
            OR COALESCE((regexp_match(COALESCE(pv.user_agent, ''), '\\\\(([^)]*)\\\\)'))[1], COALESCE(pv.user_agent, '')) ILIKE '%tablet%' THEN 'tablet'
          WHEN COALESCE((regexp_match(COALESCE(pv.user_agent, ''), '\\\\(([^)]*)\\\\)'))[1], COALESCE(pv.user_agent, '')) ILIKE '%iphone%'
            OR COALESCE((regexp_match(COALESCE(pv.user_agent, ''), '\\\\(([^)]*)\\\\)'))[1], COALESCE(pv.user_agent, '')) ILIKE '%android%' THEN 'phone'
          WHEN COALESCE((regexp_match(COALESCE(pv.user_agent, ''), '\\\\(([^)]*)\\\\)'))[1], COALESCE(pv.user_agent, '')) ILIKE '%windows%'
            OR COALESCE((regexp_match(COALESCE(pv.user_agent, ''), '\\\\(([^)]*)\\\\)'))[1], COALESCE(pv.user_agent, '')) ILIKE '%macintosh%'
            OR COALESCE((regexp_match(COALESCE(pv.user_agent, ''), '\\\\(([^)]*)\\\\)'))[1], COALESCE(pv.user_agent, '')) ILIKE '%linux%' THEN 'desktop'
          ELSE 'other'
        END AS device_type
      FROM playlist_views pv
      WHERE ${dateFilter('pv.created_at')}
    ),
    playlist_device_counts AS (
      SELECT
        cv.playlist_id,
        COUNT(*) FILTER (WHERE cv.device_type = 'phone') AS phone_views,
        COUNT(*) FILTER (WHERE cv.device_type = 'desktop') AS desktop_views,
        COUNT(*) FILTER (WHERE cv.device_type = 'tablet') AS tablet_views,
        COUNT(*) FILTER (WHERE cv.device_type = 'other') AS other_device_views
      FROM classified_views cv
      GROUP BY cv.playlist_id
    )
    SELECT
      p.id AS playlist_id,
      p.title,
      p.thumbnail_url,
      COALESCE(pvc.videos, 0) AS videos,
      COALESCE(puc.unique_users, 0) AS unique_users,
      COALESCE(pvc2.total_views, 0) AS period_view_count,
      COALESCE(psc.total_saves, 0) AS period_save_count,
      COALESCE(pdc.phone_views, 0) AS phone_views,
      COALESCE(pdc.desktop_views, 0) AS desktop_views,
      COALESCE(pdc.tablet_views, 0) AS tablet_views,
      COALESCE(pdc.other_device_views, 0) AS other_device_views
    FROM playlists p
    LEFT JOIN playlist_video_counts pvc ON pvc.playlist_id = p.id
    LEFT JOIN playlist_user_counts puc ON puc.playlist_id = p.id
    LEFT JOIN playlist_view_counts pvc2 ON pvc2.playlist_id = p.id
    LEFT JOIN playlist_save_counts psc ON psc.playlist_id = p.id
    LEFT JOIN playlist_device_counts pdc ON pdc.playlist_id = p.id
    WHERE ${playlistCondition}
    GROUP BY
      p.id,
      p.title,
      p.thumbnail_url,
      pvc.videos,
      puc.unique_users,
      pvc2.total_views,
      psc.total_saves,
      pdc.phone_views,
      pdc.desktop_views,
      pdc.tablet_views,
      pdc.other_device_views
    ORDER BY period_view_count DESC, period_save_count DESC
    LIMIT 15
  `;
}

function getCompletionBucketsSql(includePrivate = false) {
  const videoCondition = publicVideosCondition('v', includePrivate);

  return `
    SELECT
      COUNT(*) FILTER (WHERE wp.percentage_watched < 25) AS lt25,
      COUNT(*) FILTER (WHERE wp.percentage_watched >= 25 AND wp.percentage_watched < 50) AS bt25_50,
      COUNT(*) FILTER (WHERE wp.percentage_watched >= 50 AND wp.percentage_watched < 75) AS bt50_75,
      COUNT(*) FILTER (WHERE wp.percentage_watched >= 75 AND wp.percentage_watched < 95) AS bt75_95,
      COUNT(*) FILTER (WHERE wp.percentage_watched >= 95) AS gte95
    FROM watch_progress wp
    JOIN videos v ON v.id = wp.video_id
    WHERE ${videoCondition}
      AND ${dateFilter('wp.last_watched_at')}
  `;
}

function buildLineChartSvg(points, options = {}) {
  const width = options.width || 680;
  const height = options.height || 180;
  const color = options.color || '#2563eb';
  const valueKey = options.valueKey || 'value';
  const labelKey = options.labelKey || 'label';
  const padding = { top: 16, right: 14, bottom: 30, left: 42 };

  if (!points || points.length === 0) {
    return `
      <svg class="chartSvg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
        <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#94a3b8" font-size="12">
          No data available for this period
        </text>
      </svg>
    `;
  }

  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const values = points.map((p) => Number(p[valueKey] || 0));
  const maxValue = Math.max(...values, 1);

  const coords = points.map((point, index) => {
    const x = padding.left + (index * innerW) / Math.max(points.length - 1, 1);
    const y = padding.top + innerH - (Number(point[valueKey] || 0) / maxValue) * innerH;

    return {
      x,
      y,
      label: point[labelKey],
    };
  });

  const polyline = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const gridLines = 4;

  const yGrid = Array.from({ length: gridLines + 1 })
    .map((_, i) => {
      const y = padding.top + (i * innerH) / gridLines;
      const value = maxValue - (i * maxValue) / gridLines;

      return `
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#e2e8f0" />
        <text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="9" fill="#94a3b8">${Math.round(value)}</text>
      `;
    })
    .join('');

  const dots = coords
    .map((c) => `<circle cx="${c.x}" cy="${c.y}" r="3" fill="${color}" />`)
    .join('');

  const maxXAxisLabels = Math.max(4, Math.floor(innerW / 56));
  const labelStep = Math.max(1, Math.ceil(points.length / maxXAxisLabels));
  const xLabels = coords
    .map((c, i) => {
      const isFirst = i === 0;
      const isLast = i === coords.length - 1;
      const shouldShow = isFirst || isLast || i % labelStep === 0;
      if (!shouldShow) return '';
      return `
        <text x="${c.x}" y="${height - 8}" text-anchor="middle" font-size="9" fill="#64748b">
          ${escapeHtml(c.label)}
        </text>
      `;
    })
    .join('');

  return `
    <svg class="chartSvg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
      ${yGrid}
      <line x1="${padding.left}" y1="${padding.top + innerH}" x2="${width - padding.right}" y2="${padding.top + innerH}" stroke="#cbd5e1" />
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + innerH}" stroke="#cbd5e1" />
      <polyline fill="none" stroke="${color}" stroke-width="2.5" points="${polyline}" />
      ${dots}
      ${xLabels}
    </svg>
  `;
}

function buildMultiLineChartSvg(points, series, options = {}) {
  const width = options.width || 680;
  const height = options.height || 220;
  const labelKey = options.labelKey || 'label';
  const padding = { top: 20, right: 16, bottom: 34, left: 42 };

  if (!points || points.length === 0 || !series || series.length === 0) {
    return `
      <svg class="chartSvg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
        <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#94a3b8" font-size="12">
          No data available for this period
        </text>
      </svg>
    `;
  }

  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const maxValue = Math.max(
    ...series.flatMap((line) => points.map((point) => Number(point[line.valueKey] || 0))),
    1,
  );
  const gridLines = 4;

  const yGrid = Array.from({ length: gridLines + 1 })
    .map((_, i) => {
      const y = padding.top + (i * innerH) / gridLines;
      const value = maxValue - (i * maxValue) / gridLines;

      return `
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#e2e8f0" />
        <text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="9" fill="#94a3b8">${Math.round(value)}</text>
      `;
    })
    .join('');

  const maxXAxisLabels = Math.max(4, Math.floor(innerW / 56));
  const labelStep = Math.max(1, Math.ceil(points.length / maxXAxisLabels));
  const xLabels = points
    .map((point, index) => {
      const x = padding.left + (index * innerW) / Math.max(points.length - 1, 1);
      const isFirst = index === 0;
      const isLast = index === points.length - 1;
      const shouldShow = isFirst || isLast || index % labelStep === 0;
      if (!shouldShow) return '';

      return `
        <text x="${x}" y="${height - 8}" text-anchor="middle" font-size="9" fill="#64748b">
          ${escapeHtml(point[labelKey])}
        </text>
      `;
    })
    .join('');

  const paths = series
    .map((line) => {
      const polyline = points
        .map((point, index) => {
          const x = padding.left + (index * innerW) / Math.max(points.length - 1, 1);
          const y = padding.top + innerH - (Number(point[line.valueKey] || 0) / maxValue) * innerH;
          return `${x},${y}`;
        })
        .join(' ');

      return `<polyline fill="none" stroke="${line.color}" stroke-width="${line.strokeWidth || 1.6}" points="${polyline}" />`;
    })
    .join('');

  const legend = series
    .map((line, index) => {
      const x = padding.left + index * 150;
      return `
        <line x1="${x}" y1="10" x2="${x + 18}" y2="10" stroke="${line.color}" stroke-width="${line.strokeWidth || 1.6}" />
        <text x="${x + 24}" y="13" font-size="9" fill="#475569">${escapeHtml(line.label)}</text>
      `;
    })
    .join('');

  return `
    <svg class="chartSvg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
      ${legend}
      ${yGrid}
      <line x1="${padding.left}" y1="${padding.top + innerH}" x2="${width - padding.right}" y2="${padding.top + innerH}" stroke="#cbd5e1" />
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + innerH}" stroke="#cbd5e1" />
      ${paths}
      ${xLabels}
    </svg>
  `;
}

function buildBarChartSvg(items, options = {}) {
  const width = options.width || 680;
  const rowHeight = options.rowHeight || 24;
  const color = options.color || '#2563eb';
  const colors = options.colors || null;
  const barHeight = options.barHeight || 14;
  const barRadius = options.barRadius || 5;
  const suffix = options.suffix || '';
  const labelKey = options.labelKey || 'label';
  const valueKey = options.valueKey || 'value';
  const height = Math.max(90, 22 + (items?.length || 0) * rowHeight);

  if (!items || items.length === 0) {
    return `
      <svg class="chartSvg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
        <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#94a3b8" font-size="12">
          No data available for this period
        </text>
      </svg>
    `;
  }

  const labelArea = 170;
  const valueArea = 64;
  const chartArea = width - labelArea - valueArea - 20;
  const maxValue = Math.max(...items.map((item) => Number(item[valueKey] || 0)), 1);

  const rows = items
    .map((item, index) => {
      const y = 14 + index * rowHeight;
      const value = Number(item[valueKey] || 0);
      const barWidth = (value / maxValue) * chartArea;
      const barColor = colors?.[index % colors.length] || color;

      return `
        <text x="0" y="${y + 10}" font-size="10" fill="#0f172a">${escapeHtml(shortLabel(item[labelKey], 30))}</text>
        <rect x="${labelArea}" y="${y - 2}" width="${chartArea}" height="${barHeight}" rx="${barRadius}" fill="#eef2ff" />
        <rect x="${labelArea}" y="${y - 2}" width="${barWidth}" height="${barHeight}" rx="${barRadius}" fill="${barColor}" />
        <text x="${labelArea + chartArea + 8}" y="${y + 9}" font-size="10" fill="#334155">
          ${value.toFixed(Number.isInteger(value) ? 0 : 1)}${escapeHtml(suffix)}
        </text>
      `;
    })
    .join('');

  return `
    <svg class="chartSvg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
      ${rows}
    </svg>
  `;
}

function buildVerticalBarChartSvg(items, options = {}) {
  const width = options.width || 680;
  const height = options.height || 200;
  const color = options.color || '#2563eb';
  const labelKey = options.labelKey || 'label';
  const valueKey = options.valueKey || 'value';
  const padding = { top: 18, right: 18, bottom: 44, left: 24 };

  if (!items || items.length === 0) {
    return `
      <svg class="chartSvg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
        <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#94a3b8" font-size="12">
          No data available for this period
        </text>
      </svg>
    `;
  }

  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const maxValue = Math.max(...items.map((item) => Number(item[valueKey] || 0)), 1);
  const barGap = 18;
  const barWidth = Math.min(80, (innerW - barGap * (items.length - 1)) / Math.max(items.length, 1));

  const bars = items
    .map((item, index) => {
      const value = Number(item[valueKey] || 0);
      const barHeight = (value / maxValue) * innerH;
      const x = padding.left + index * (barWidth + barGap);
      const y = padding.top + innerH - barHeight;
      const label = shortLabel(item[labelKey], 14);

      return `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="8" fill="${color}" />
        <text x="${x + barWidth / 2}" y="${y - 6}" text-anchor="middle" font-size="10" fill="#334155">${fmtNum(value)}</text>
        <text x="${x + barWidth / 2}" y="${height - 10}" text-anchor="middle" font-size="10" fill="#64748b">${escapeHtml(label)}</text>
      `;
    })
    .join('');

  return `
    <svg class="chartSvg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
      <line x1="${padding.left}" y1="${padding.top + innerH}" x2="${width - padding.right}" y2="${padding.top + innerH}" stroke="#cbd5e1" />
      ${bars}
    </svg>
  `;
}

function buildIcon(name, size = 12, color = '#334155') {
  const common = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"`;

  const icons = {
    phone: `
      <svg ${common}>
        <rect x="7" y="2.5" width="10" height="19" rx="2.5" stroke="${color}" stroke-width="1.8"/>
        <circle cx="12" cy="18.2" r="1" fill="${color}"/>
      </svg>
    `,
    desktop: `
      <svg ${common}>
        <rect x="3" y="4" width="18" height="12" rx="2" stroke="${color}" stroke-width="1.8"/>
        <path d="M9 20H15M12 16V20" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    `,
    tablet: `
      <svg ${common}>
        <rect x="5.5" y="2.5" width="13" height="19" rx="2.2" stroke="${color}" stroke-width="1.8"/>
        <circle cx="12" cy="18.2" r="1" fill="${color}"/>
      </svg>
    `,
    other: `
      <svg ${common}>
        <circle cx="12" cy="12" r="8" stroke="${color}" stroke-width="1.8"/>
        <circle cx="12" cy="12" r="1.5" fill="${color}"/>
      </svg>
    `,
    like: `
      <svg ${common}>
        <path d="M10 10V21H5.5A2.5 2.5 0 0 1 3 18.5V12.5A2.5 2.5 0 0 1 5.5 10H10ZM10 10L13.2 3.8A1.8 1.8 0 0 1 16.5 5.1L15.6 10H19a2 2 0 0 1 2 2.3l-1.1 6.5A2.5 2.5 0 0 1 17.4 21H10" stroke="${color}" stroke-width="1.7" stroke-linejoin="round"/>
      </svg>
    `,
    dislike: `
      <svg ${common}>
        <path d="M14 14V3H18.5A2.5 2.5 0 0 1 21 5.5V11.5A2.5 2.5 0 0 1 18.5 14H14ZM14 14L10.8 20.2A1.8 1.8 0 0 1 7.5 18.9L8.4 14H5a2 2 0 0 1-2-2.3l1.1-6.5A2.5 2.5 0 0 1 6.6 3H14" stroke="${color}" stroke-width="1.7" stroke-linejoin="round"/>
      </svg>
    `,
    comments: `
      <svg ${common}>
        <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H11l-4 4v-4H7.5A2.5 2.5 0 0 1 5 12.5v-6Z" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>
      </svg>
    `,
  };

  return icons[name] || icons.other;
}

function buildDonutChartCard(items, options = {}) {
  const normalized = (items || [])
    .map((item, index) => ({
      label: String(item.label || 'Other'),
      value: Number(item.value || 0),
      color: item.color || options.colors?.[index % (options.colors?.length || 1)] || '#94a3b8',
    }))
    .filter((item) => item.value > 0);

  const total = normalized.reduce((sum, item) => sum + item.value, 0);

  if (!total) {
    return `<div class="emptyState">No data available for this chart</div>`;
  }

  const outerRadius = 95;
  const innerRadius = 61;
  let angle = -Math.PI / 2;

  const polarToCartesian = (cx, cy, radius, rad) => ({
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  });

  const segments = normalized
    .map((item) => {
      const sliceAngle = (item.value / total) * Math.PI * 2;
      const startAngle = angle;
      const endAngle = angle + sliceAngle;
      angle = endAngle;

      const largeArcFlag = sliceAngle > Math.PI ? 1 : 0;
      const outerStart = polarToCartesian(110, 110, outerRadius, startAngle);
      const outerEnd = polarToCartesian(110, 110, outerRadius, endAngle);
      const innerEnd = polarToCartesian(110, 110, innerRadius, endAngle);
      const innerStart = polarToCartesian(110, 110, innerRadius, startAngle);

      const path = [
        `M ${outerStart.x} ${outerStart.y}`,
        `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
        `L ${innerEnd.x} ${innerEnd.y}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerStart.x} ${innerStart.y}`,
        'Z',
      ].join(' ');

      return `
        <path d="${path}" fill="${item.color}" />
      `;
    })
    .join('');

  const legend = normalized
    .map((item) => {
      const pct = total ? (item.value / total) * 100 : 0;
      return `
        <div class="donutLegendItem">
          <span class="donutLegendSwatch" style="background:${item.color};"></span>
          <div class="donutLegendMeta">
            <div class="donutLegendLabel">${escapeHtml(item.label)}</div>
            <div class="donutLegendValue">${fmtNum(item.value)} <span>• ${fmtPct(pct, 0)}</span></div>
          </div>
        </div>
      `;
    })
    .join('');

  return `
    <div class="donutCard">
      <div class="donutVisual">
        <svg class="donutSvg" viewBox="0 0 220 220" preserveAspectRatio="xMidYMid meet">
          <circle cx="110" cy="110" r="${outerRadius}" fill="#e2e8f0" />
          <circle cx="110" cy="110" r="${innerRadius}" fill="#ffffff" />
          ${segments}
        </svg>
        <div class="donutCenter">
          <div class="donutCenterValue">${fmtNum(total)}</div>
          <div class="donutCenterLabel">${escapeHtml(options.centerLabel || 'views')}</div>
        </div>
      </div>
      <div class="donutLegend">
        ${legend}
      </div>
    </div>
  `;
}

function summarizeDeviceBreakdown(rows = []) {
  const deviceMap = new Map();
  const osMap = new Map();

  for (const row of rows) {
    const device = row.device_type || 'other';
    const os = row.os_name || 'Other';
    const count = Number(row.cnt || 0);

    deviceMap.set(device, (deviceMap.get(device) || 0) + count);
    osMap.set(os, (osMap.get(os) || 0) + count);
  }

  const devices = Array.from(deviceMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const osList = Array.from(osMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  return { devices, osList };
}

function summarizeGeographyBreakdown(rows = []) {
  const countryMap = new Map();

  for (const row of rows) {
    const country = String(row.country || 'Unknown').trim() || 'Unknown';
    const countryIso = resolveCountryIso2(row.country_iso);
    const city = String(row.city || 'Unknown city').trim() || 'Unknown city';
    const count = Number(row.cnt || 0);

    if (!countryMap.has(country)) {
      countryMap.set(country, {
        country,
        value: 0,
        iso2: countryIso,
        cities: new Map(),
      });
    }

    const countryEntry = countryMap.get(country);
    countryEntry.value += count;
    countryEntry.cities.set(city, (countryEntry.cities.get(city) || 0) + count);
  }

  return Array.from(countryMap.values())
    .map((entry) => ({
      country: entry.country,
      value: entry.value,
      iso2: entry.iso2,
      cities: Array.from(entry.cities.entries())
        .map(([city, value]) => ({ city, value }))
        .sort((a, b) => b.value - a.value || a.city.localeCompare(b.city)),
    }))
    .sort((a, b) => b.value - a.value || a.country.localeCompare(b.country));
}

function buildHtml(report, options) {
  const overview = report.overview || {};

  const timelinePoints = (report.timeline || []).map((row) => ({
    label: formatDateLabel(row.bucket, options.groupBy),
    views: Number(row.views || 0),
    watchHours: Number(row.watch_seconds || 0) / 3600,
  }));

  const activeUserPoints = (report.activeUsersTimeline || []).map((row) => ({
    label: formatDateLabel(row.bucket, options.groupBy),
    activeUsers: Number(row.active_users || 0),
  }));

  const signupPoints = (report.userSignupsTimeline || []).map((row) => ({
    label: formatDateLabel(row.bucket, options.groupBy),
    signups: Number(row.signups || 0),
  }));
  const activeUsersByLabel = new Map(activeUserPoints.map((point) => [point.label, point.activeUsers]));
  const signupsByLabel = new Map(signupPoints.map((point) => [point.label, point.signups]));
  const trendChartPoints = timelinePoints.map((point) => ({
    label: point.label,
    views: point.views,
    watchHours: point.watchHours,
    activeUsers: activeUsersByLabel.get(point.label) || 0,
    signups: signupsByLabel.get(point.label) || 0,
  }));

  const { devices, osList } = summarizeDeviceBreakdown(report.deviceBreakdown || []);
  const geographyBreakdown = summarizeGeographyBreakdown(report.geographyBreakdown || []);
  const deviceChartItems = devices.map((item, index) => ({
    ...item,
    label: item.label.charAt(0).toUpperCase() + item.label.slice(1),
    color: ['#1f54de', '#4d79e6', '#7a9ced', '#b8c8e3'][index % 4],
  }));
  const osChartItems = osList.map((item, index) => ({
    ...item,
    color: ['#163ca0', '#1f54de', '#4d79e6', '#7a9ced', '#9fb6dc', '#ec8b55'][index % 6],
  }));

  const completion = report.completionBuckets || {};
  const completionItems = [
    { label: '< 25%', value: Number(completion.lt25 || 0) },
    { label: '25 - 50%', value: Number(completion.bt25_50 || 0) },
    { label: '50 - 75%', value: Number(completion.bt50_75 || 0) },
    { label: '75 - 95%', value: Number(completion.bt75_95 || 0) },
    { label: '95%+', value: Number(completion.gte95 || 0) },
  ];

  const audienceSplitItems = [
    { label: 'EAES members', value: Number(overview.eaes_member_video_views || 0) },
    {
      label: 'Non-members',
      value: Number(overview.non_member_video_views || 0) + Number(overview.anonymous_video_views || 0),
    },
  ];

  const topVideosWatchChart = (report.topVideos || []).slice(0, 10).map((row) => ({
    label: shortLabel(row.title, 28),
    value: Number(row.total_watch_seconds || 0) / 3600,
  }));

  const topVideosEngagementChart = [...(report.topVideos || [])]
    .sort((a, b) => {
      const engagementDiff = Number(b.engagement_rate || 0) - Number(a.engagement_rate || 0);
      if (engagementDiff !== 0) return engagementDiff;

      const watchDiff = Number(b.total_watch_seconds || 0) - Number(a.total_watch_seconds || 0);
      if (watchDiff !== 0) return watchDiff;

      return Number(b.total_views || 0) - Number(a.total_views || 0);
    })
    .slice(0, 10)
    .map((row) => ({
      label: shortLabel(row.title, 28),
      value: Number(row.engagement_rate || 0),
    }));

  const topPlaylistsChart = (report.playlists || []).slice(0, 10).map((row) => ({
    label: shortLabel(row.title, 28),
    value: Number(row.period_view_count || 0),
  }));

  const uniqueVideoViewers = Number(overview.unique_video_viewers || 0);
  const totalWatchSeconds = Number(overview.total_watch_seconds || 0);
  const avgWatchPerViewer = uniqueVideoViewers ? totalWatchSeconds / uniqueVideoViewers : 0;

  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const logoHtml = REPORT_LOGO_URL
    ? `<img class="brandLogo" src="${escapeHtml(REPORT_LOGO_URL)}" alt="EAES logo" />`
    : `<div class="brandBadge">EAES</div>`;

  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>EAES Video Corner Analytics Report</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 8mm 8mm 12mm 8mm;
    }

    :root {
      --surface: #ffffff;
      --text: #0f172a;
      --muted: #64748b;
      --border: #e2e8f0;
      --primary: #1f54de;
      --primary-dark: #163ca0;
      --accentBlue: #1f54de;
      --accentBlue2: #163ca0;
      --accentBlueSoft: #7a9ced;
      --accentBluePale: #dce6f4;
      --accentOrange: #ec8b55;
      --shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: var(--text);
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .report-root {
      width: 100%;
      max-width: 100%;
    }

    .header {
      background: var(--accentBlue);
      color: white;
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 18px;
      box-shadow: var(--shadow);
      page-break-inside: avoid;
    }

    .headerRow {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .brandWrap {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .brandLogo {
      width: 40px;
      height: 40px;
      object-fit: contain;
      border-radius: 8px;
      background: white;
      padding: 5px;
      flex-shrink: 0;
    }

    .brandBadge {
      width: 40px;
      height: 40px;
      border-radius: 8px;
      background: rgba(255,255,255,.18);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      flex-shrink: 0;
    }

    .headerTitle {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 4px;
    }

    .headerSub {
      font-size: 11px;
      opacity: .95;
      line-height: 1.35;
    }

    .headerMeta {
      text-align: right;
      font-size: 10px;
      line-height: 1.4;
      white-space: nowrap;
    }

    .section {
      margin-bottom: 28px;
    }

    .sectionTitle {
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 8px 0;
      page-break-after: avoid;
      break-after: avoid;
    }

    .kpiGrid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }

    .card, .chartCard {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px;
      box-shadow: var(--shadow);
      outline: 1px solid var(--border);
      outline-offset: -1px;
      page-break-inside: avoid;
      overflow: hidden;
    }

    .tableCard {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px;
      box-shadow: var(--shadow);
      outline: 1px solid var(--border);
      outline-offset: -1px;
      overflow: hidden;
      page-break-inside: auto;
    }

    .tableCard.allowPageBreak {
      overflow: visible;
      page-break-inside: auto;
      break-inside: auto;
      -webkit-box-decoration-break: clone;
      box-decoration-break: clone;
    }

    .kpiLabel {
      font-size: 9px;
      color: var(--muted);
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: .3px;
    }

    .kpiValue {
      font-size: 18px;
      font-weight: 700;
      line-height: 1.1;
    }

    .kpiSub {
      font-size: 10px;
      color: var(--muted);
      margin-top: 5px;
      line-height: 1.35;
    }

    .chartsStack > .chartCard {
      margin-bottom: 10px;
    }

    .chartsStack > .chartCard:last-child {
      margin-bottom: 0;
    }

    .twoUpGrid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 10px;
    }

    .twoUpGrid > .chartCard {
      margin-bottom: 0;
    }

    .chartGrid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .chartGrid > .chartCard {
      margin-bottom: 0;
    }

    .chartTitle {
      font-size: 12px;
      font-weight: 700;
      margin-bottom: 6px;
    }

    .chartSvg {
      display: block;
      width: 100%;
      max-width: 100%;
      height: auto;
    }

    .smallNote {
      color: var(--muted);
      font-size: 9px;
      margin-top: 4px;
    }

    .geoGrid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .geoCountry {
      border: 1px solid #d9e4f7;
      border-radius: 14px;
      padding: 14px;
      background: linear-gradient(180deg, #ffffff 0%, #f7faff 100%);
      display: flex;
      flex-direction: column;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .geoCountryHeader {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    .geoCountryMeta {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      min-width: 0;
    }

    .flagThumb {
      width: 28px;
      height: 20px;
      border-radius: 4px;
      object-fit: cover;
      border: 1px solid #d6e1f5;
      box-shadow: 0 1px 1px rgba(15, 23, 42, 0.06);
      flex-shrink: 0;
    }

    .flagThumbFallback {
      width: 28px;
      height: 20px;
      border-radius: 4px;
      background: #eef4ff;
      border: 1px solid #d6e1f5;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
      color: var(--accentBlue2);
      flex-shrink: 0;
    }

    .geoCountryName {
      font-size: 13px;
      font-weight: 700;
      color: var(--text);
      line-height: 1.2;
    }

    .geoCountryViews {
      font-size: 12px;
      font-weight: 700;
      color: var(--accentBlue);
      white-space: nowrap;
      padding: 5px 8px;
      border-radius: 999px;
      background: #edf3ff;
    }

    .geoCities {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 2px;
    }

    .geoCity {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 9px;
      border-radius: 10px;
      background: #eef4ff;
      color: #334155;
      font-size: 10px;
      border: 1px solid #d8e4f8;
    }

    .geoCity strong {
      color: var(--accentBlue2);
      font-weight: 700;
    }

    .tableWrap {
      width: 100%;
      overflow: hidden;
    }

    .tableCard.allowPageBreak .tableWrap {
      overflow: visible;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    thead {
      display: table-header-group;
    }

    th, td, tr {
      page-break-inside: avoid;
    }

    thead th {
      font-size: 8px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: .3px;
      text-align: left;
      background: #f8fafc;
      padding: 7px 6px;
      border-top: 0;
      border-bottom: 1px solid var(--border);
    }

    tbody td {
      font-size: 9px;
      padding: 7px 6px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
      word-wrap: break-word;
    }

    .textCenter {
      text-align: center;
      vertical-align: middle;
    }

    .originalVideoTable {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    .originalVideoTable thead th {
      background: #f8fafc;
      padding: 8px 10px;
      text-align: left;
      font-size: 9px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.3px;
      border-top: 0;
      border-bottom: 1px solid var(--border);
      box-shadow: none;
    }

    .originalVideoTable tbody tr {
      border-bottom: 1px solid var(--border);
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .originalVideoTable tbody td {
      padding: 10px;
      vertical-align: middle;
      font-size: 10px;
      border-bottom: 0;
    }

    .rankBadge {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: linear-gradient(135deg, #f3f4f6, #e5e7eb);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 11px;
      color: var(--text);
    }

    td.rank {
      text-align: center;
      vertical-align: middle;
    }

    .videoCell {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      min-width: 0;
    }

    .thumbWrapper {
      flex-shrink: 0;
      position: relative;
    }

    .thumb {
      width: 120px;
      height: 68px;
      border-radius: 6px;
      object-fit: cover;
      border: 1px solid var(--border);
      background: #f1f5f9;
    }

    .thumb.placeholder {
      background: #f1f5f9;
    }

    .durationBadge {
      position: absolute;
      bottom: 6px;
      right: 3px;
      background: rgba(0, 0, 0, 0.55);
      color: white;
      padding: 2px 4px;
      border-radius: 3px;
      font-size: 8px;
      font-weight: 600;
      line-height: 1;
    }

    .videoInfo {
      flex: 1;
      min-width: 0;
    }

    .titleLink {
      display: block;
      font-weight: 600;
      font-size: 11px;
      color: var(--text);
      text-decoration: none;
      margin-bottom: 4px;
      line-height: 1.2;
    }

    .stats {
      display: flex;
      gap: 10px;
      margin-bottom: 4px;
      flex-wrap: wrap;
    }

    .statItem {
      font-size: 9px;
      color: var(--muted);
    }

    .memberStats {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .memberItem {
      font-size: 9px;
      color: var(--muted);
    }

    .watchTime .primary,
    .avgWatch .primary {
      font-size: 11px;
      font-weight: 700;
      color: var(--text);
    }

    .watchTime .secondary,
    .avgWatch .secondary {
      font-size: 9px;
      color: var(--muted);
      margin-top: 2px;
    }

    .vDivider {
      width: 1px;
      height: 30px;
      background: #e2e8f0;
    }

    .deviceGrid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 4px;
    }

    .deviceItem {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 5px;
      padding: 3px 5px;
      background: #f8fafc;
      border-radius: 4px;
      font-size: 9px;
      font-weight: 600;
      color: var(--text);
    }

    .metricIcon {
      width: 14px;
      height: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: #475569;
    }

    .metricIcon svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    .reactionStack {
      font-size: 9px;
      line-height: 1.45;
      color: var(--text);
    }

    .reactionItem {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .donutCard {
      display: flex;
      align-items: center;
      gap: 18px;
      min-height: 220px;
    }

    .donutVisual {
      position: relative;
      width: 180px;
      height: 180px;
      flex-shrink: 0;
      margin: 0 auto;
    }

    .donutSvg {
      width: 100%;
      height: 100%;
      display: block;
    }

    .donutCenter {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      text-align: center;
    }

    .donutCenterValue {
      font-size: 26px;
      line-height: 1;
      font-weight: 700;
      color: var(--text);
    }

    .donutCenterLabel {
      margin-top: 6px;
      font-size: 11px;
      color: var(--muted);
      text-transform: lowercase;
    }

    .donutLegend {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .donutLegendItem {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }

    .donutLegendSwatch {
      width: 12px;
      height: 12px;
      border-radius: 3px;
      margin-top: 2px;
      flex-shrink: 0;
    }

    .donutLegendMeta {
      min-width: 0;
    }

    .donutLegendLabel {
      font-size: 11px;
      font-weight: 700;
      color: var(--text);
      line-height: 1.2;
    }

    .donutLegendValue {
      font-size: 10px;
      color: var(--muted);
      margin-top: 2px;
    }

    .emptyState {
      padding: 30px 16px;
      text-align: center;
      color: var(--muted);
      font-size: 11px;
    }

    .playlistThumb {
      width: 88px;
      height: 50px;
      object-fit: cover;
      border-radius: 6px;
      border: 1px solid var(--border);
      flex-shrink: 0;
      background: #f1f5f9;
    }

    .playlistThumb.placeholder {
      background: #f1f5f9;
    }

    .videoMeta {
      min-width: 0;
      flex: 1;
    }

    .videoMetaTitle {
      color: var(--text);
      font-weight: 600;
      line-height: 1.3;
      font-size: 10px;
    }

    .footerNote {
      margin-top: 6px;
      color: var(--muted);
      font-size: 9px;
      line-height: 1.35;
    }
  </style>
</head>
<body>
  <div class="report-root">
    <div class="header">
      <div class="headerRow">
        <div class="brandWrap">
          ${logoHtml}
          <div>
            <div class="headerTitle">EAES Video Corner Analytics Report</div>
            <div class="headerSub">
              Period: ${escapeHtml(options.label)} • Grouped by ${escapeHtml(options.groupBy)} • ${options.includePrivate ? 'Includes private content' : 'Public content only'}
            </div>
          </div>
        </div>
        <div class="headerMeta">
          Generated at<br />
          ${escapeHtml(generatedAt)}
        </div>
      </div>
    </div>

    <div class="section">
      <div class="sectionTitle">Executive overview</div>
      <div class="kpiGrid">
        <div class="card">
          <div class="kpiLabel">Total users</div>
          <div class="kpiValue">${fmtNum(overview.total_users)}</div>
          <div class="kpiSub">Declared EAES members: ${fmtNum(overview.eaes_members)}</div>
        </div>

        <div class="card">
          <div class="kpiLabel">New users in period</div>
          <div class="kpiValue">${fmtNum(overview.new_users_in_period)}</div>
          <div class="kpiSub">Registrations inside selected range</div>
        </div>

        <div class="card">
          <div class="kpiLabel">Videos / playlists</div>
          <div class="kpiValue">${fmtNum(overview.total_videos)} / ${fmtNum(overview.total_playlists)}</div>
          <div class="kpiSub">Content totals</div>
        </div>

        <div class="card">
          <div class="kpiLabel">Video views</div>
          <div class="kpiValue">${fmtNum(overview.total_video_views)}</div>
          <div class="kpiSub">Unique viewers: ${fmtNum(overview.unique_video_viewers)}</div>
        </div>

        <div class="card">
          <div class="kpiLabel">Watch time</div>
          <div class="kpiValue">${fmtHMS(overview.total_watch_seconds)}</div>
          <div class="kpiSub">Total platform watch time</div>
        </div>

        <div class="card">
          <div class="kpiLabel">Avg watch time per viewer</div>
          <div class="kpiValue">${fmtHMS(avgWatchPerViewer)}</div>
          <div class="kpiSub">Based on logged-in unique viewers</div>
        </div>

        <div class="card">
          <div class="kpiLabel">Video reactions</div>
          <div class="kpiValue">${fmtNum(overview.total_reactions)}</div>
          <div class="kpiSub">Likes: ${fmtNum(overview.total_likes)} • Dislikes: ${fmtNum(overview.total_dislikes)}</div>
        </div>

        <div class="card">
          <div class="kpiLabel">Playlist saves</div>
          <div class="kpiValue">${fmtNum(overview.total_playlist_saves)}</div>
          <div class="kpiSub">Saved playlists across selected period</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="sectionTitle">Top video performance</div>
      <div class="tableCard allowPageBreak">
        <div class="tableWrap">
          <table class="originalVideoTable">
            <thead>
              <tr>
                <th style="width:42px;">#</th>
                <th>Video</th>
                <th style="width:90px;">Watch time</th>
                <th style="width:120px;">Avg watch</th>
                <th style="width:110px;">Devices</th>
                <th style="width:86px;">Reactions</th>
              </tr>
            </thead>
            <tbody>
              ${(report.topVideos || []).length
                ? (report.topVideos || [])
                    .map((r, idx) => {
                      const videoUrl = `${FRONTEND_VIDEO_BASE}${encodeURIComponent(r.video_id)}`;

                      const thumb = r.thumbnail_url
                        ? `<img class="thumb" src="${escapeHtml(r.thumbnail_url)}" alt="thumbnail" />`
                        : `<div class="thumb placeholder"></div>`;

                      const durationBadge = r.duration_seconds
                        ? `<div class="durationBadge">${fmtHMS(r.duration_seconds)}</div>`
                        : '';

                      return `
                        <tr>
                          <td class="rank">
                            <div class="rankBadge"><span>${idx + 1}</span></div>
                          </td>

                          <td class="videoCell">
                            <div class="thumbWrapper">
                              ${thumb}
                              ${durationBadge}
                            </div>

                            <div class="videoInfo">
                              <a class="titleLink" href="${escapeHtml(videoUrl)}">${escapeHtml(r.title || 'Untitled')}</a>

                              <div class="stats">
                                <div class="statItem"><span>${fmtNum(r.total_views)} views</span></div>
                                <div class="statItem"><span>${fmtNum(r.unique_users)} unique</span></div>
                              </div>

                            </div>
                          </td>

                          <td class="watchTime">
                            <div class="primary">${fmtHMS(r.total_watch_seconds)}</div>
                            <div class="secondary">${Number(r.total_watch_hours || 0).toFixed(2)}h total</div>
                          </td>

                          <td class="avgWatch">
                            <div style="display:flex; align-items:center; justify-content:center; gap:5px;">
                              <div style="text-align:left;">
                                <div class="primary">${fmtHMS(r.avg_watch_seconds_per_view)}</div>
                                <div class="secondary">avg/view</div>
                              </div>
                              <div class="vDivider"></div>
                              <div style="text-align:left;">
                                <div class="primary">${fmtHMS(r.avg_watch_seconds_per_user)}</div>
                                <div class="secondary">avg/user</div>
                              </div>
                            </div>
                          </td>

                          <td class="deviceBreakdown">
                            <div class="deviceGrid">
                              <div class="deviceItem"><span class="metricIcon">${buildIcon('phone')}</span><span>${fmtNum(r.phone_views)}</span></div>
                              <div class="deviceItem"><span class="metricIcon">${buildIcon('desktop')}</span><span>${fmtNum(r.desktop_views)}</span></div>
                              <div class="deviceItem"><span class="metricIcon">${buildIcon('tablet')}</span><span>${fmtNum(r.tablet_views)}</span></div>
                              <div class="deviceItem"><span class="metricIcon">${buildIcon('other')}</span><span>${fmtNum(r.other_device_views)}</span></div>
                            </div>
                          </td>

                          <td class="reactionsCell">
                            <div class="reactionStack">
                              <div class="reactionItem"><span class="metricIcon">${buildIcon('like')}</span><span>${fmtNum(r.likes)}</span></div>
                              <div class="reactionItem"><span class="metricIcon">${buildIcon('dislike')}</span><span>${fmtNum(r.dislikes)}</span></div>
                              <div class="reactionItem"><span class="metricIcon">${buildIcon('comments')}</span><span>${fmtNum(r.comments)}</span></div>
                            </div>
                          </td>
                        </tr>
                      `;
                    })
                    .join('')
                : `
                  <tr>
                    <td colspan="6">
                      <div class="emptyState">No video data available for the selected period</div>
                    </td>
                  </tr>
                `}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="sectionTitle">Trends</div>
        <div class="chartCard">
        <div class="chartTitle">Platform activity over time</div>
        ${buildMultiLineChartSvg(
          trendChartPoints,
          [
            { label: 'Views', valueKey: 'views', color: '#1f54de', strokeWidth: 1.5 },
            { label: 'Watch hours', valueKey: 'watchHours', color: '#163ca0', strokeWidth: 1.5 },
            { label: 'Active users', valueKey: 'activeUsers', color: '#7a9ced', strokeWidth: 1.5 },
            { label: 'Signups', valueKey: 'signups', color: '#ec8b55', strokeWidth: 1.5 },
          ],
        )}
      </div>
    </div>

    <div class="section">
      <div class="sectionTitle">Audience breakdown</div>
      <div class="chartsStack">
        <div class="twoUpGrid">
          <div class="chartCard">
            <div class="chartTitle">Device split</div>
            ${buildDonutChartCard(deviceChartItems, { centerLabel: 'total views' })}
          </div>

          <div class="chartCard">
            <div class="chartTitle">Operating systems</div>
            ${buildDonutChartCard(osChartItems, { centerLabel: 'views' })}
          </div>
        </div>

        <div class="twoUpGrid">
          <div class="chartCard">
            <div class="chartTitle">Completion buckets</div>
            ${buildDonutChartCard(
              completionItems.map((item, index) => ({
                ...item,
                color: ['#163ca0', '#1f54de', '#4d79e6', '#7a9ced', '#9fb6dc'][index % 5],
              })),
              { centerLabel: 'progress split' },
            )}
            <div class="smallNote">Based on watch_progress.percentage_watched</div>
          </div>

          <div class="chartCard">
            <div class="chartTitle">Viewer type split</div>
            ${buildDonutChartCard(
              audienceSplitItems.map((item, index) => ({
                ...item,
                color: ['#1f54de', '#9fb6dc'][index % 2],
              })),
              { centerLabel: 'viewer mix' },
            )}
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="sectionTitle">Geographic breakdown</div>
      ${
        geographyBreakdown.length
          ? `
          <div class="geoGrid">
            ${geographyBreakdown
              .map((countryRow) => {
                const flagUrl = getFlagImageUrl(countryRow.iso2);
                const flagHtml = flagUrl
                  ? `<img class="flagThumb" src="${escapeHtml(flagUrl)}" alt="${escapeHtml(countryRow.country)} flag" />`
                  : `<span class="flagThumbFallback">${escapeHtml((countryRow.iso2 || countryRow.country.slice(0, 2) || '--').toUpperCase())}</span>`;

                return `
                  <div class="geoCountry">
                    <div class="geoCountryHeader">
                      <div class="geoCountryMeta">
                        ${flagHtml}
                        <div class="geoCountryName">${escapeHtml(countryRow.country)}</div>
                      </div>
                      <div class="geoCountryViews">${fmtNum(countryRow.value)} views</div>
                    </div>
                    <div class="geoCities">
                      ${countryRow.cities
                        .slice(0, 8)
                        .map(
                          (cityRow) => `
                            <span class="geoCity">
                              <span>${escapeHtml(cityRow.city)}</span>
                              <strong>${fmtNum(cityRow.value)}</strong>
                            </span>
                          `,
                        )
                        .join('')}
                      ${
                        countryRow.cities.length > 8
                          ? `<span class="geoCity"><span>More cities</span><strong>+${fmtNum(countryRow.cities.length - 8)}</strong></span>`
                          : ''
                      }
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
        `
          : `<div class="chartCard"><div class="emptyState">No geographic data available for the selected period</div></div>`
      }
    </div>

    <div class="section">
      <div class="sectionTitle">Top content charts</div>
      <div class="chartsStack">
        <div class="chartCard">
          <div class="chartTitle">Top videos by engagement rate</div>
          ${buildBarChartSvg(topVideosEngagementChart, {
            color: '#1f54de',
            colors: ['#1f54de', '#7a9ced'],
            barHeight: 10,
            barRadius: 3,
            suffix: '%',
          })}
          <div class="smallNote">Engagement = total watch seconds / (views × video duration)</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="sectionTitle">Playlist performance</div>
      <div class="tableCard">
        <div class="tableWrap">
          <table>
            <thead>
              <tr>
                <th style="width:42px;">#</th>
                <th style="width:46%;">Playlist</th>
                <th class="textCenter" style="width:10%;">Videos</th>
                <th class="textCenter" style="width:14%;">Unique users</th>
                <th class="textCenter" style="width:15%;">Views</th>
                <th class="textCenter" style="width:15%;">Saves</th>
                <th style="width:120px;">Devices</th>
              </tr>
            </thead>
            <tbody>
              ${(report.playlists || [])
                .map((row, idx) => {
                  const thumb = row.thumbnail_url
                    ? `<img class="playlistThumb" src="${escapeHtml(row.thumbnail_url)}" alt="playlist thumbnail" />`
                    : `<div class="playlistThumb placeholder"></div>`;

                  return `
                    <tr>
                      <td class="rank">
                        <div class="rankBadge"><span>${idx + 1}</span></div>
                      </td>
                      <td>
                        <div class="videoCell">
                          ${thumb}
                          <div class="videoMeta">
                            <div class="videoMetaTitle">${escapeHtml(row.title || 'Untitled')}</div>
                          </div>
                        </div>
                      </td>
                      <td class="textCenter">${fmtNum(row.videos)}</td>
                      <td class="textCenter">${fmtNum(row.unique_users)}</td>
                      <td class="textCenter">${fmtNum(row.period_view_count)}</td>
                      <td class="textCenter">${fmtNum(row.period_save_count)}</td>
                      <td class="deviceBreakdown">
                        <div class="deviceGrid">
                          <div class="deviceItem"><span class="metricIcon">${buildIcon('phone')}</span><span>${fmtNum(row.phone_views)}</span></div>
                          <div class="deviceItem"><span class="metricIcon">${buildIcon('desktop')}</span><span>${fmtNum(row.desktop_views)}</span></div>
                          <div class="deviceItem"><span class="metricIcon">${buildIcon('tablet')}</span><span>${fmtNum(row.tablet_views)}</span></div>
                          <div class="deviceItem"><span class="metricIcon">${buildIcon('other')}</span><span>${fmtNum(row.other_device_views)}</span></div>
                        </div>
                      </td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

export async function generateVideoAnalyticsPdfReport(rawOptions = {}) {
  let browser = null;

  try {
    const options = normalizeReportOptions(rawOptions);
    const params = [options.from, options.to];

    const [
      overviewResult,
      timelineResult,
      activeUsersTimelineResult,
      userSignupsTimelineResult,
      deviceBreakdownResult,
      geographyBreakdownResult,
      topVideosResult,
      playlistsResult,
      completionBucketsResult,
    ] = await Promise.all([
      readPool.query(getOverviewSql(options.includePrivate), params),
      readPool.query(getVideoTimelineSql(options.groupBy, options.includePrivate), params),
      readPool.query(getActiveUsersTimelineSql(options.groupBy, options.includePrivate), params),
      readPool.query(getUserSignupsTimelineSql(options.groupBy), params),
      readPool.query(getDeviceBreakdownSql(options.includePrivate), params),
      readPool.query(getGeographyBreakdownSql(options.includePrivate), params),
      readPool.query(getTopVideosSql(options.includePrivate), params),
      readPool.query(getPlaylistPerformanceSql(options.includePrivate), params),
      readPool.query(getCompletionBucketsSql(options.includePrivate), params),
    ]);

    const report = {
      overview: overviewResult.rows?.[0] || {},
      timeline: timelineResult.rows || [],
      activeUsersTimeline: activeUsersTimelineResult.rows || [],
      userSignupsTimeline: userSignupsTimelineResult.rows || [],
      deviceBreakdown: deviceBreakdownResult.rows || [],
      geographyBreakdown: geographyBreakdownResult.rows || [],
      topVideos: topVideosResult.rows || [],
      playlists: playlistsResult.rows || [],
      completionBuckets: completionBucketsResult.rows?.[0] || {},
    };

    const html = buildHtml(report, options);

    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();

    await page.setViewport({
      width: 1200,
      height: 1800,
      deviceScaleFactor: 2,
    });

    page.setDefaultNavigationTimeout(120000);
    page.setDefaultTimeout(120000);

    await page.setContent(html, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });

    await page.waitForSelector('.report-root', { timeout: 120000 });

    await page.evaluate(async () => {
      if (document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch {}
      }
    });

    await page.evaluate(async () => {
      const images = Array.from(document.images || []);
      const waitForImage = (img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            });

      await Promise.race([
        Promise.all(images.map(waitForImage)),
        new Promise((resolve) => setTimeout(resolve, 10000)),
      ]);
    });

    await new Promise((resolve) => setTimeout(resolve, 250));

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm',
      },
    });

    await browser.close();
    browser = null;

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const safeRange = options.range === 'custom' ? 'custom' : options.range;

    return {
      pdfBuffer,
      filename: `${mm}-${yyyy}-video-corner-analytics-${safeRange}.pdf`,
    };
  } catch (err) {
    console.error('PDF report error:', err);

    if (browser) {
      try {
        await browser.close();
      } catch {}
    }

    throw err;
  }
}

