/**
 * A custom PostCSS config REPLACES Next's default chain (flexbugs-fixes +
 * preset-env) for every stylesheet, including globals.css. Autoprefixer is
 * restored explicitly so properties the house stylesheet ships unprefixed
 * (backdrop-filter and friends) keep their vendor prefixes.
 */
export default {
  plugins: {
    "@tailwindcss/postcss": {},
    autoprefixer: {},
  },
};
