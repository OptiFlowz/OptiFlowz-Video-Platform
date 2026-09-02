/**
 * Central platform theme contract.
 *
 * Keep this module free of React, DOM, and browser-only APIs so the same theme
 * can be used by server metadata, generated images, and client-side styling.
 * During the CSS migration, hardcoded visual values should be moved here and
 * referenced through the corresponding CSS custom property.
 */

export const THEME_SCHEMA_VERSION = 1;

type CssCustomPropertyName = `--${string}`;

/**
 * Low-level palette used while legacy styles are migrated to semantic tokens.
 * The hex strings intentionally live only in this central theme module.
 */
export const DEFAULT_THEME_PALETTE_HEX_VALUES = [
  "000000",
  "003e8e",
  "00b3ff",
  "00ff55",
  "020408",
  "02050a",
  "030509",
  "03070b",
  "05070b",
  "05080d",
  "05080e",
  "06080c",
  "06090f",
  "070a10",
  "071238",
  "071b35",
  "080d18",
  "087ff5",
  "090a0b",
  "090d16",
  "091c42",
  "0a0c10",
  "0a0c12",
  "0b1422",
  "0b3269",
  "0c0c0c",
  "0d2036",
  "10b981",
  "11141a",
  "11151e",
  "12151d",
  "12151e",
  "1256b4",
  "126de0",
  "141414",
  "161a24",
  "164194",
  "181b26",
  "181c26",
  "18a957",
  "1a1d25",
  "1b7fcc",
  "1c1c1c",
  "1c1e28",
  "1c1f2a",
  "1e232f",
  "2148ad",
  "268cff",
  "272935",
  "2859df",
  "28a745",
  "2ac96a",
  "2c64ff",
  "31343f",
  "338cff",
  "34a853",
  "3b82f6",
  "3f78f0",
  "4285f4",
  "48b4aa",
  "495153",
  "49beb4",
  "4b5563",
  "4c9aff",
  "4d75e5",
  "589dff",
  "69a9ff",
  "69dc8e",
  "7093e8",
  "72a7ff",
  "73acff",
  "7df7a4",
  "7eb84b",
  "7f8499",
  "7f8ba3",
  "888888",
  "8c9ab8",
  "92400e",
  "94a3b8",
  "9bb4dc",
  "9c1313",
  "9ca3af",
  "9e0014",
  "a0a3af",
  "a15c00",
  "a855f7",
  "b2b0be",
  "b9dcff",
  "bc3939",
  "c5d1e5",
  "c8d5e8",
  "c995ff",
  "cdd0d9",
  "ce3939",
  "d0fae5",
  "d1d5db",
  "d88400",
  "daf5e1",
  "dd8c8c",
  "e04747",
  "ea4335",
  "ea8c39",
  "ec8b55",
  "ededed",
  "eec179",
  "ef4444",
  "f13939",
  "f38063",
  "f3f4f6",
  "f59e0b",
  "f8fafd",
  "f9fafb",
  "fbbc05",
  "fbbf24",
  "ff2e2e",
  "ff5c5c",
  "ff6b6b",
  "ff9a9a",
  "ffb2b2",
  "ffbb00",
  "ffc4c4",
  "ffffff",
] as const;

type ThemePaletteHex = (typeof DEFAULT_THEME_PALETTE_HEX_VALUES)[number];
type ThemePaletteVariableName = `--palette-${ThemePaletteHex}`;

const DEFAULT_THEME_PALETTE = Object.fromEntries(
  DEFAULT_THEME_PALETTE_HEX_VALUES.map((hex) => [
    `--palette-${hex}`,
    `#${hex}`,
  ]),
) as Readonly<Record<ThemePaletteVariableName, string>>;

export const DEFAULT_THEME_CSS_VARIABLES = {
  ...DEFAULT_THEME_PALETTE,

  "--colorBlack": "var(--palette-000000)",
  "--colorWhite": "var(--palette-ffffff)",

  "--background": "#090a0b",
  "--foreground": "#ededed",

  "--gabarito":
    "var(--font-gabarito), ui-sans-serif, system-ui, sans-serif",
  "--solitreo": "var(--font-solitreo), ui-rounded, \"Segoe Print\", cursive",
  "--contentWidth": "1400px",
  "--bR": "calc(infinity * 1px)",

  "--backgroundC1": "rgba(49, 52, 63, 0.4)",
  "--backgroundC2": "rgba(28, 30, 40, 0.6)",
  "--blueAccent1": "#003e8e",
  "--blueAccent2": "#338cff",
  "--blueAccent3": "#4c9aff",
  "--blueButtonGradient":
    "linear-gradient(-45deg, var(--blueAccent1), var(--blueAccent2), var(--blueAccent3))",

  "--background1": "var(--background)",
  "--background2": "var(--backgroundC1)",
  "--background15": "rgba(39, 41, 53, 0.15)",
  "--background3": "var(--backgroundC2)",
  "--background4": "#11141a",
  "--backgroundGradient1":
    "linear-gradient(90deg, rgba(255, 255, 255, 0.04) 25%, rgba(255, 255, 255, 0.08) 50%, rgba(255, 255, 255, 0.04) 75%)",

  // Legacy CSS spelling is preserved until the stylesheet is migrated.
  "--seethroughtBlack": "rgba(0, 0, 0, 0.6)",
  "--seeThroughtWhite": "rgba(255, 255, 255, 0.92)",

  "--borderC1": "rgba(255, 255, 255, 0.14)",
  "--borderC2": "rgba(255, 255, 255, 0.035)",
  "--border1": "var(--borderC1)",
  "--border2": "var(--borderC2)",
  "--border3": "rgba(255, 255, 255, 0.06)",
  "--borderWhite": "rgba(255, 255, 255, 1)",

  "--textC1": "rgba(255, 255, 255, 0.6)",
  "--textC2": "rgba(255, 255, 255, 0.7)",
  "--text1": "var(--foreground)",
  "--text2": "var(--textC1)",
  "--text3": "var(--textC2)",
  "--threadC1": "#495153",

  "--accentRedC1": "rgb(255, 46, 46, 0.5)",
  "--accentBlue": "var(--blueAccent1)",
  "--accentBlue2": "var(--blueAccent2)",
  "--accentBlue3": "var(--blueAccent3)",
  "--accentOrange": "var(--blueAccent2)",
  "--accentOrange2": "var(--blueAccent3)",
  "--accentGray": "rgba(255, 255, 255, 0.5)",
  "--accentRed": "rgb(188, 57, 57)",
  "--accentRed2": "rgba(188, 57, 57, 0.5)",
  "--accentRed3": "rgb(241, 57, 57)",
  "--accentGreen1": "rgb(208, 250, 229)",
  "--accentGreen2": "rgb(126, 184, 75)",
  "--progressAccentOrange": "var(--blueAccent2)",

  "--analyticsChart1": "#2148ad",
  "--analyticsChart2": "#2859df",
  "--analyticsChart3": "#4d75e5",
  "--analyticsChart4": "#7093e8",
  "--analyticsChart5": "#9bb4dc",
  "--analyticsChart6": "#c5d1e5",
  "--analyticsWatchTimeOverTime": "#3f78f0",
  "--analyticsViewsOverTime": "#f59e0b",
  "--analyticsSignupsOverTime": "#10b981",
  "--analyticsActiveUsersOverTime": "#a855f7",
  "--analyticsCompletionBuckets": "#ef4444",

  "--playButtonBg1": "rgba(0, 0, 0, 0.6)",
  "--headerSurface": "rgba(5, 7, 11, 0.72)",
  "--headerBorderColor": "rgba(255, 255, 255, 0.08)",
  "--headerShadowColor": "rgba(0, 0, 0, 0.28)",

  "--neutralTextStrong": "oklch(44.6% 0.03 256.802)",
  "--neutralSurfaceStrong": "oklch(37.3% 0.034 259.733)",
  "--neutralBorder": "oklch(55.1% 0.027 264.364)",
  "--dangerText": "oklch(70.4% 0.191 22.216)",
  "--successSurfaceSoft": "oklch(95% 0.052 163.051)",
  "--successTextStrong": "oklch(50.8% 0.118 165.612)",
  "--neutralSurfaceSoft": "oklch(92.9% 0.013 255.508)",
  "--neutralTextMuted": "oklch(44.6% 0.043 257.281)",

  "--privacyBannerSurface":
    "linear-gradient(135deg, rgba(7, 10, 16, 0.88), rgba(3, 5, 9, 0.84))",
  "--privacyDialogSurface":
    "linear-gradient(145deg, rgba(6, 9, 15, 0.96), rgba(2, 4, 8, 0.94))",
  "--privacyBackdropSurface": "rgba(2, 5, 10, 0.58)",
  "--privacyBorderColor": "rgba(255, 255, 255, 0.16)",
  "--privacyActionBorderColor": "rgba(255, 255, 255, 0.15)",
  "--privacyRowBorderColor": "rgba(255, 255, 255, 0.1)",
  "--privacyActionSurface": "rgba(255, 255, 255, 0.07)",
  "--privacyActionHoverSurface": "rgba(255, 255, 255, 0.11)",
  "--privacyMutedActionSurface": "rgba(255, 255, 255, 0.035)",
  "--privacyRowSurface": "rgba(255, 255, 255, 0.055)",
  "--privacyInsetHighlight": "rgba(255, 255, 255, 0.08)",
  "--privacySoftInsetHighlight": "rgba(255, 255, 255, 0.04)",
  "--privacyStrongInsetHighlight": "rgba(255, 255, 255, 0.25)",
  "--privacyStrongInsetHighlightHover": "rgba(255, 255, 255, 0.28)",
  "--privacyAccentGlow": "rgba(51, 140, 255, 0.16)",
  "--privacyAccentBorderColor": "rgba(88, 157, 255, 0.82)",
  "--privacyAccentHoverBorderColor": "rgba(105, 169, 255, 0.65)",
  "--privacyAccentFocusColor": "rgba(105, 169, 255, 0.95)",
  "--privacyAccentShadowColor": "rgba(51, 140, 255, 0.3)",
  "--privacyAccentShadowHoverColor": "rgba(51, 140, 255, 0.38)",
  "--privacyBannerShadowColor": "rgba(0, 0, 0, 0.58)",
  "--privacyDialogShadowColor": "rgba(0, 0, 0, 0.68)",
  "--privacyActionShadowColor": "rgba(0, 0, 0, 0.2)",
  "--privacyPrimarySurface":
    "linear-gradient(135deg, var(--accentBlue2), var(--accentBlue))",
  "--privacyPrimaryHoverSurface":
    "linear-gradient(135deg, var(--accentBlue3), var(--accentBlue2))",

  "--footerSurface":
    "linear-gradient(180deg, var(--background1) 0%, var(--background4) 50%, color-mix(in srgb, var(--accentBlue) 58%, var(--background1)) 100%)",
  "--headerHeight": "90px",
} as const satisfies Readonly<Record<CssCustomPropertyName, string>>;

export type ThemeCssVariableName = keyof typeof DEFAULT_THEME_CSS_VARIABLES;
export type ThemeCssVariables = Readonly<
  Record<ThemeCssVariableName, string>
>;

export type ThemeMetadataColors = Readonly<{
  browserThemeColor: string;
  manifestBackgroundColor: string;
  manifestThemeColor: string;
}>;

export type ThemeOpenGraphColors = Readonly<{
  text: string;
  background: string;
  markBorder: string;
  markBorderAccent: string;
  markShadow: string;
  subtitle: string;
}>;

export type PlatformTheme = Readonly<{
  schemaVersion: number;
  id: string;
  name: string;
  cssVariables: ThemeCssVariables;
  metadata: ThemeMetadataColors;
  openGraph: ThemeOpenGraphColors;
}>;

export type PlatformThemeOverrides = Readonly<{
  id?: string;
  name?: string;
  cssVariables?: Partial<ThemeCssVariables>;
  metadata?: Partial<ThemeMetadataColors>;
  openGraph?: Partial<ThemeOpenGraphColors>;
}>;

export const DEFAULT_THEME = {
  schemaVersion: THEME_SCHEMA_VERSION,
  id: "optiflowz-default",
  name: "OptiFlowz Default",
  cssVariables: DEFAULT_THEME_CSS_VARIABLES,
  metadata: {
    browserThemeColor: "#05080d",
    manifestBackgroundColor: "#05080d",
    manifestThemeColor: "#087ff5",
  },
  openGraph: {
    text: "#ffffff",
    background:
      "radial-gradient(circle at 82% 18%, #126de0 0, #0b3269 20%, transparent 47%), linear-gradient(135deg, #03070b 0%, #0b1422 62%, #071b35 100%)",
    markBorder: "#268cff",
    markBorderAccent: "#b9dcff",
    markShadow: "0 0 42px rgba(38, 140, 255, 0.55)",
    subtitle: "#c8d5e8",
  },
} as const satisfies PlatformTheme;

/**
 * Produces a complete theme from a trusted, validated override payload.
 * Validation belongs at the API boundary before persisted values reach here.
 */
export function mergePlatformTheme(
  overrides: PlatformThemeOverrides = {},
  baseTheme: PlatformTheme = DEFAULT_THEME,
): PlatformTheme {
  return {
    ...baseTheme,
    id: overrides.id ?? baseTheme.id,
    name: overrides.name ?? baseTheme.name,
    cssVariables: {
      ...baseTheme.cssVariables,
      ...overrides.cssVariables,
    },
    metadata: {
      ...baseTheme.metadata,
      ...overrides.metadata,
    },
    openGraph: {
      ...baseTheme.openGraph,
      ...overrides.openGraph,
    },
  };
}

/** Returns a mutable record suitable for a React style prop or serialization. */
export function getThemeCssVariables(
  theme: PlatformTheme = DEFAULT_THEME,
): Record<ThemeCssVariableName, string> {
  return { ...theme.cssVariables };
}
