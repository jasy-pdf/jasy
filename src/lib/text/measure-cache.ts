/**
 * Whether a `Text` reuses its measured height when every input to the measurement is unchanged.
 * Not public: it is switched off only by the test that renders documents both ways and demands the
 * same bytes, which is what proves the cache changes nothing.
 */
export const textMeasureCache = { enabled: true };
