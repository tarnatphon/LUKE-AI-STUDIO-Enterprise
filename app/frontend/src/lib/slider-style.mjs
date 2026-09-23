/**
 * Fill percentage for a range input, as a CSS custom property.
 *
 * This lived inside Settings.jsx. ModelManager.jsx grew a context-window slider
 * and reached for the same helper by name — but it was never exported, so the
 * reference resolved to nothing and the `typeof` guard quietly fell back to no
 * styling. The slider worked and looked unfinished, with no error anywhere.
 * Shared so both use one implementation.
 */
export const getSliderStyle = (value, min, max) => {
  const v = Number(value);
  const mn = Number(min);
  const mx = Number(max);
  const pct = mx === mn ? 0 : ((v - mn) / (mx - mn)) * 100;
  return { "--value": `${pct}%` };
};
